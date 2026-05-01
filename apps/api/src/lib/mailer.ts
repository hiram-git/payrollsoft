import type { CompanyConfig } from '@payroll/db'
import nodemailer from 'nodemailer'

export type MailerConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

export type MailMessage = {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Convert a tenant's `company_config` row into a usable mailer
 * configuration. Returns null when the company hasn't filled out the
 * SMTP fields (host + an address to send from); callers should treat
 * that as "mail is not configured" rather than as an error.
 */
export function mailerConfigFromCompany(company: CompanyConfig | null): MailerConfig | null {
  if (!company || !company.mailHost) return null

  const fromAddress = company.mailFromAddress ?? company.mailUsername
  if (!fromAddress) return null

  const fromName = company.mailFromName ?? company.companyName ?? 'PayrollSoft'
  const encryption = (company.mailEncryption ?? '').toLowerCase()
  // SSL on 465; STARTTLS upgrades a plain 587 connection. Anything else
  // (including 'tls' on 587) is treated as STARTTLS — secure: false.
  const secure = encryption === 'ssl' || company.mailPort === 465

  return {
    host: company.mailHost,
    port: company.mailPort,
    secure,
    user: company.mailUsername ?? undefined,
    pass: company.mailPassword ?? undefined,
    from: `"${fromName}" <${fromAddress}>`,
  }
}

/**
 * Send a single email via the tenant's SMTP server. Throws on transport
 * errors so the caller can decide whether to surface or log them.
 */
export async function sendMail(config: MailerConfig, message: MailMessage): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  })
  await transporter.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}
