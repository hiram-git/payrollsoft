import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { type SiacapEmployee, SiacapPdf } from '../../../../lib/pdf/siacap-pdf'
import { computeBuckets, fetchGovernmentReportData } from '../../../../lib/reports/government-data'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const tenantSlug = resolveTenantSlugFromCookie(authCookie)

  const payrollId = url.searchParams.get('payrollId')
  if (!payrollId) return new Response('payrollId requerido', { status: 400 })

  const result = await fetchGovernmentReportData(payrollId, authCookie, tenantSlug)
  if (result.kind === 'unauthorized') return redirect('/login')
  if (result.kind === 'not-found') return new Response('Planilla no encontrada', { status: 404 })
  if (result.kind === 'bad-status') return new Response('Planilla no generada', { status: 409 })
  if (result.kind === 'error') return new Response(result.message, { status: result.status })

  const { payroll, company, groups, ungrouped } = result.data
  const allLines = [...groups.flatMap((g) => g.lines), ...ungrouped]

  // Resolve socialSecurityNumber per employee via the /employees/:id endpoint
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': tenantSlug }
  const ssnCache = new Map<string, string | null>()
  async function resolveSsn(empId: string): Promise<string | null> {
    if (ssnCache.has(empId)) return ssnCache.get(empId) ?? null
    try {
      const res = await fetch(`${API_URL}/employees/${empId}`, { headers })
      if (!res.ok) {
        ssnCache.set(empId, null)
        return null
      }
      const json = (await res.json()) as { data?: { socialSecurityNumber?: string | null } }
      const val = json.data?.socialSecurityNumber ?? null
      ssnCache.set(empId, val)
      return val
    } catch {
      ssnCache.set(empId, null)
      return null
    }
  }

  const employees: SiacapEmployee[] = []
  for (const entry of allLines) {
    const b = computeBuckets(entry.line.concepts)
    const ssn = await resolveSsn(entry.employee.id)
    employees.push({
      code: entry.employee.code,
      idNumber: entry.employee.idNumber,
      socialSecurityNumber: ssn,
      salary: b.devengado,
      firstName: entry.employee.firstName,
      lastName: entry.employee.lastName,
      paymentDate: payroll.paymentDate,
    })
  }

  employees.sort((a, b) => a.code.localeCompare(b.code))

  const element = React.createElement(SiacapPdf, { payroll, company, employees })
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  const pdfBytes = new Uint8Array(buffer)

  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="siacap-${payrollId.slice(0, 8)}.pdf"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
