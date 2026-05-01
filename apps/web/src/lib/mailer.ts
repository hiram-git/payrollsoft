import nodemailer from 'nodemailer'

export type CompanyMailFields = {
  companyName: string | null
  mailHost: string | null
  mailPort: number
  mailEncryption: string | null
  mailUsername: string | null
  mailPassword: string | null
  mailFromAddress: string | null
  mailFromName: string | null
}

export type MailerConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

export type MailAttachment = {
  filename: string
  content: Buffer | Uint8Array
  contentType?: string
}

export type MailMessage = {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: MailAttachment[]
}

/**
 * Convert a tenant's `company_config` row into a usable mailer
 * configuration. Returns null when SMTP is not configured (host or
 * from-address missing); callers should treat that as "no email
 * delivery configured" rather than as an error.
 */
export function mailerConfigFromCompany(company: CompanyMailFields | null): MailerConfig | null {
  if (!company || !company.mailHost) return null

  const fromAddress = company.mailFromAddress ?? company.mailUsername
  if (!fromAddress) return null

  const fromName = company.mailFromName ?? company.companyName ?? 'PayrollSoft'
  const encryption = (company.mailEncryption ?? '').toLowerCase()
  // SSL on 465; STARTTLS upgrades a plain 587 connection. Anything else
  // is treated as STARTTLS — secure: false.
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
 *
 * Reuses a transporter per `host:port:user` triple — `nodemailer` opens
 * a connection pool internally so back-to-back sends share TCP state.
 */
const transporterCache = new Map<string, nodemailer.Transporter>()

function getTransporter(config: MailerConfig): nodemailer.Transporter {
  const cacheKey = `${config.host}:${config.port}:${config.user ?? ''}`
  const existing = transporterCache.get(cacheKey)
  if (existing) return existing

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    pool: true,
  })
  transporterCache.set(cacheKey, transporter)
  return transporter
}

export async function sendMail(config: MailerConfig, message: MailMessage): Promise<void> {
  const transporter = getTransporter(config)
  await transporter.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: message.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
      contentType: a.contentType,
    })),
  })
}
