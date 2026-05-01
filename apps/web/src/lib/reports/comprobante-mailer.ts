import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { buildPayslipEmail } from '../email-templates/payslip'
import { type CompanyMailFields, mailerConfigFromCompany, sendMail } from '../mailer'
import { type StubEmployee, type StubLine, type StubPayroll, StubPdf } from '../pdf/stub-pdf'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'
const REPORT_LINES_LIMIT = 100000

type ApiPayrollResponse = {
  data: {
    payroll: StubPayroll & { id: string; status: string }
    lines: Array<{
      line: StubLine & { id: string }
      employee: StubEmployee & { id: string; email: string | null }
    }>
  }
}

type ApiCompanyResponse = {
  data:
    | (CompanyMailFields & {
        currencySymbol: string | null
      })
    | null
}

export type SendOutcome = {
  lineId: string
  employeeId: string
  employeeName: string
  email: string | null
  status: 'sent' | 'skipped_no_email' | 'failed'
  error?: string
}

export type SendResult =
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'bad-status'; status: string }
  | { kind: 'mail-not-configured' }
  | { kind: 'ok'; outcomes: SendOutcome[] }
  | { kind: 'error'; message: string; status?: number }

function fmtNet(amount: string | number): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0.00'
  return n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function safeFilename(employeeName: string, periodStart: string): string {
  const slug = employeeName
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `comprobante-${slug || 'empleado'}-${periodStart}.pdf`
}

async function renderPayslipPdf(
  payroll: StubPayroll,
  employee: StubEmployee,
  line: StubLine
): Promise<Uint8Array> {
  const element = React.createElement(StubPdf, { payroll, employee, line })
  // @react-pdf/renderer's typing doesn't line up with React 19's
  // FunctionComponentElement; runtime is fine.
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  return new Uint8Array(buffer)
}

/**
 * Fetch the full payroll + company config from the API, render the
 * comprobante PDF for each requested line, and email it to the
 * employee's address. Lines without an employee email are skipped
 * (returned as `skipped_no_email`); transport failures are recorded
 * per-line so a partial outage still tells the operator who got their
 * payslip and who didn't.
 *
 * `lineIds` filters the work to a subset; pass `null` to send to
 * everyone.
 */
export async function sendComprobanteEmails(
  payrollId: string,
  authCookie: string,
  lineIds: string[] | null
): Promise<SendResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  const payrollUrl = new URL(`${API_URL}/payroll/${payrollId}`)
  payrollUrl.searchParams.set('linesPage', '1')
  payrollUrl.searchParams.set('linesLimit', String(REPORT_LINES_LIMIT))

  let payrollRes: Response
  let companyRes: Response
  try {
    ;[payrollRes, companyRes] = await Promise.all([
      fetch(payrollUrl, { headers }),
      fetch(`${API_URL}/company`, { headers }),
    ])
  } catch (err) {
    return {
      kind: 'error',
      status: 502,
      message: err instanceof Error ? err.message : 'Error de conexión con el servidor',
    }
  }

  if (payrollRes.status === 401) return { kind: 'unauthorized' }
  if (payrollRes.status === 404) return { kind: 'not-found' }
  if (!payrollRes.ok) {
    return { kind: 'error', status: 500, message: 'Error al obtener la planilla' }
  }

  const payrollJson = (await payrollRes.json()) as ApiPayrollResponse
  const { payroll, lines } = payrollJson.data

  // Only generated/closed payrolls have computed lines worth mailing.
  if (payroll.status !== 'generated' && payroll.status !== 'closed') {
    return { kind: 'bad-status', status: payroll.status }
  }

  let company: ApiCompanyResponse['data'] = null
  if (companyRes.ok) {
    try {
      const json = (await companyRes.json()) as ApiCompanyResponse
      company = json.data
    } catch {
      company = null
    }
  }

  const mailerConfig = mailerConfigFromCompany(company)
  if (!mailerConfig) return { kind: 'mail-not-configured' }

  const allowed = lineIds ? new Set(lineIds) : null
  const targets = allowed ? lines.filter((l) => allowed.has(l.line.id)) : lines

  const outcomes: SendOutcome[] = []
  const currencySymbol = company?.currencySymbol ?? '$'
  const companyName = company?.companyName ?? null

  // Fallback path: if the /payroll endpoint doesn't include the email
  // (older API build that still ships the pre-fix payload), look it up
  // directly on /employees/:id. The result is cached per employee for
  // the duration of this request so a 100-line bulk send only hits the
  // endpoint once per missing address.
  const employeeEmailCache = new Map<string, string | null>()
  async function resolveEmployeeEmail(
    employeeId: string,
    initial: unknown
  ): Promise<string | null> {
    const trimmed = typeof initial === 'string' ? initial.trim() : ''
    if (trimmed.length > 0) return trimmed
    if (employeeEmailCache.has(employeeId)) return employeeEmailCache.get(employeeId) ?? null
    try {
      const res = await fetch(`${API_URL}/employees/${employeeId}`, { headers })
      if (!res.ok) {
        employeeEmailCache.set(employeeId, null)
        return null
      }
      const json = (await res.json()) as { data?: { email?: string | null } }
      const fetched = typeof json.data?.email === 'string' ? json.data.email.trim() : ''
      const result = fetched.length > 0 ? fetched : null
      employeeEmailCache.set(employeeId, result)
      return result
    } catch {
      employeeEmailCache.set(employeeId, null)
      return null
    }
  }

  for (const entry of targets) {
    const employee = entry.employee
    const employeeName = `${employee.firstName} ${employee.lastName}`.trim()
    const email = await resolveEmployeeEmail(employee.id, employee.email)

    if (!email) {
      console.warn(
        `Comprobante skip — line ${entry.line.id} (employee ${employee.id} ${employeeName}) has no email; received value:`,
        JSON.stringify(employee.email)
      )
      outcomes.push({
        lineId: entry.line.id,
        employeeId: employee.id,
        employeeName,
        email: null,
        status: 'skipped_no_email',
      })
      continue
    }

    try {
      const pdfBytes = await renderPayslipPdf(payroll, employee, entry.line)
      const message = buildPayslipEmail({
        employeeName,
        payrollName: payroll.name,
        periodStart: payroll.periodStart,
        periodEnd: payroll.periodEnd,
        paymentDate: payroll.paymentDate,
        netAmount: fmtNet(entry.line.netAmount),
        currencySymbol,
        companyName,
      })
      await sendMail(mailerConfig, {
        to: email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: [
          {
            filename: safeFilename(employeeName, payroll.periodStart),
            content: pdfBytes,
            contentType: 'application/pdf',
          },
        ],
      })
      outcomes.push({
        lineId: entry.line.id,
        employeeId: employee.id,
        employeeName,
        email,
        status: 'sent',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Comprobante mail error for line ${entry.line.id}:`, err)
      outcomes.push({
        lineId: entry.line.id,
        employeeId: employee.id,
        employeeName,
        email,
        status: 'failed',
        error: message,
      })
    }
  }

  return { kind: 'ok', outcomes }
}
