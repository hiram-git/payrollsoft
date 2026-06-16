import { companyConfig, employees } from '@payroll/db'
import { eq } from 'drizzle-orm'
import { mailerConfigFromCompany, sendMail } from '../../lib/mailer'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

type NotifyContext = {
  employeeName: string
  employeeCode: string
  documentNumber?: string
  typeName?: string
  subtypeName?: string
  reason?: string
}

async function getCompanyAndEmployee(db: AnyDb, employeeId: string) {
  const [[company], [emp]] = await Promise.all([
    db.select().from(companyConfig).limit(1),
    db
      .select({
        email: employees.email,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1),
  ])
  return { company: company ?? null, employee: emp ?? null }
}

function buildHtml(title: string, body: string, companyName: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px;">
<div style="border-bottom:2px solid #003087;padding-bottom:12px;margin-bottom:20px;">
  <strong style="color:#003087;">${companyName}</strong> — Portal del Colaborador
</div>
<h2 style="font-size:18px;margin:0 0 16px;">${title}</h2>
${body}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
  Este correo fue generado automáticamente por RCG SOFTRIX.
</div>
</body></html>`
}

export async function notifyRequestCreated(db: AnyDb, employeeId: string, ctx: NotifyContext) {
  try {
    const { company, employee } = await getCompanyAndEmployee(db, employeeId)
    if (!company?.portalNotificationsEnabled) return
    const mailer = mailerConfigFromCompany(company)
    if (!mailer) return

    const companyName = company.companyName ?? 'RCG SOFTRIX'
    const subject = `Nueva solicitud: ${ctx.typeName ?? ''} — ${ctx.employeeName}`
    const body = `<p><strong>${ctx.employeeName}</strong> (${ctx.employeeCode}) ha creado una nueva solicitud.</p>
<table style="border-collapse:collapse;margin:12px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Tipo:</td><td>${ctx.typeName ?? '—'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Subtipo:</td><td>${ctx.subtypeName ?? '—'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">N° Documento:</td><td>${ctx.documentNumber ?? '—'}</td></tr>
</table>`
    const html = buildHtml('Nueva solicitud creada', body, companyName)

    const recipients: string[] = []
    if (company.notifyOnRequestCreated) {
      recipients.push(
        ...company.notifyOnRequestCreated
          .split(',')
          .map((e: string) => e.trim())
          .filter(Boolean)
      )
    }
    for (const to of recipients) {
      await sendMail(mailer, { to, subject, html }).catch(() => {})
    }
  } catch {}
}

export async function notifyRequestApproved(db: AnyDb, employeeId: string, ctx: NotifyContext) {
  try {
    const { company, employee } = await getCompanyAndEmployee(db, employeeId)
    if (!company?.portalNotificationsEnabled) return
    const mailer = mailerConfigFromCompany(company)
    if (!mailer) return

    const companyName = company.companyName ?? 'RCG SOFTRIX'
    const subject = `Solicitud aprobada: ${ctx.documentNumber ?? ''}`
    const body = `<p>La solicitud <strong>${ctx.documentNumber ?? ''}</strong> de <strong>${ctx.employeeName}</strong> ha sido <span style="color:#2e7a56;font-weight:bold;">aprobada</span>.</p>`
    const html = buildHtml('Solicitud aprobada', body, companyName)

    const recipients: string[] = []
    if (employee?.email) recipients.push(employee.email)
    if (company.notifyOnRequestApproved) {
      recipients.push(
        ...company.notifyOnRequestApproved
          .split(',')
          .map((e: string) => e.trim())
          .filter(Boolean)
      )
    }
    for (const to of [...new Set(recipients)]) {
      await sendMail(mailer, { to, subject, html }).catch(() => {})
    }
  } catch {}
}

export async function notifyRequestRejected(db: AnyDb, employeeId: string, ctx: NotifyContext) {
  try {
    const { company, employee } = await getCompanyAndEmployee(db, employeeId)
    if (!company?.portalNotificationsEnabled) return
    const mailer = mailerConfigFromCompany(company)
    if (!mailer) return

    const companyName = company.companyName ?? 'RCG SOFTRIX'
    const subject = `Solicitud rechazada: ${ctx.documentNumber ?? ''}`
    const body = `<p>La solicitud <strong>${ctx.documentNumber ?? ''}</strong> de <strong>${ctx.employeeName}</strong> ha sido <span style="color:#b53a2b;font-weight:bold;">rechazada</span>.</p>
${ctx.reason ? `<p><strong>Motivo:</strong> ${ctx.reason}</p>` : ''}`
    const html = buildHtml('Solicitud rechazada', body, companyName)

    const recipients: string[] = []
    if (employee?.email) recipients.push(employee.email)
    if (company.notifyOnRequestRejected) {
      recipients.push(
        ...company.notifyOnRequestRejected
          .split(',')
          .map((e: string) => e.trim())
          .filter(Boolean)
      )
    }
    for (const to of [...new Set(recipients)]) {
      await sendMail(mailer, { to, subject, html }).catch(() => {})
    }
  } catch {}
}
