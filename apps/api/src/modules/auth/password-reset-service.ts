import { createHash, randomBytes } from 'node:crypto'
import {
  createPasswordReset,
  findPasswordResetByTokenHash,
  findUserByEmail,
  findUserById,
  getCompanyConfig,
  invalidatePendingPasswordResets,
  markPasswordResetUsed,
  updateUserPasswordHash,
} from '@payroll/db'
import { env } from '../../config/env'
import { buildPasswordResetEmail } from '../../lib/email-templates/password-reset'
import { mailerConfigFromCompany, sendMail } from '../../lib/mailer'
import { hashPassword } from '../../lib/password'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

const TOKEN_BYTES = 32 // 256 bits → 64 hex chars after encoding
const RESET_LIFETIME_MIN = 30
const RESET_LIFETIME_MS = RESET_LIFETIME_MIN * 60_000

export type RequestResetResult =
  | { kind: 'sent' }
  | { kind: 'silent_skip' } // no user / no SMTP — caller still returns 200
  | { kind: 'mail_error'; message: string }

export type ConsumeResetResult =
  | { kind: 'ok' }
  | { kind: 'invalid' } // no such token
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'user_missing' } // referenced user was deleted

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

function buildResetUrl(tenantSlug: string, rawToken: string): string {
  const base = env.WEB_URL.replace(/\/$/, '')
  const params = new URLSearchParams({ token: rawToken, tenant: tenantSlug })
  return `${base}/reset-password?${params.toString()}`
}

/**
 * Issue a fresh password reset token for the user identified by `email`,
 * and email the magic link to them. The flow is intentionally silent
 * about whether the address exists so we don't leak account presence:
 * non-existent users return `silent_skip` and the route still answers 200.
 *
 * Mail-transport failures are surfaced to the caller because they are
 * actionable (operator misconfigured SMTP); callers may choose to log
 * them and still respond 200 to keep the flow opaque.
 */
export async function requestPasswordReset(
  db: AnyDb,
  tenantSlug: string,
  email: string
): Promise<RequestResetResult> {
  const user = await findUserByEmail(db, email)
  if (!user || !user.isActive) {
    return { kind: 'silent_skip' }
  }

  const company = await getCompanyConfig(db).catch(() => null)
  const mailerConfig = mailerConfigFromCompany(company)
  if (!mailerConfig) {
    // No SMTP configured → from the user's perspective the request was
    // accepted; surface to the caller so logs can record the gap.
    return { kind: 'silent_skip' }
  }

  // One outstanding token per user — replace any pending ones so a
  // previously stolen link can no longer redeem a new password.
  await invalidatePendingPasswordResets(db, user.id)

  const rawToken = generateRawToken()
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + RESET_LIFETIME_MS)

  await createPasswordReset(db, { userId: user.id, tokenHash, expiresAt })

  const resetUrl = buildResetUrl(tenantSlug, rawToken)
  const message = buildPasswordResetEmail({
    resetUrl,
    userName: user.name ?? null,
    companyName: company?.companyName ?? null,
    expiresInMinutes: RESET_LIFETIME_MIN,
  })

  try {
    await sendMail(mailerConfig, {
      to: user.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    return { kind: 'sent' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { kind: 'mail_error', message: reason }
  }
}

/**
 * Verify the raw token (without consuming it) so the reset page can
 * render a friendly error before asking the user to type a new password.
 */
export async function verifyPasswordResetToken(
  db: AnyDb,
  rawToken: string
): Promise<ConsumeResetResult> {
  const tokenHash = hashToken(rawToken)
  const row = await findPasswordResetByTokenHash(db, tokenHash)
  if (!row) return { kind: 'invalid' }
  if (row.usedAt) return { kind: 'used' }
  if (row.expiresAt.getTime() < Date.now()) return { kind: 'expired' }
  const user = await findUserById(db, row.userId)
  if (!user || !user.isActive) return { kind: 'user_missing' }
  return { kind: 'ok' }
}

/**
 * Redeem a token + apply the new password. Single-use: the row is
 * marked `usedAt = now()` so the same link can't be replayed.
 */
export async function consumePasswordResetToken(
  db: AnyDb,
  rawToken: string,
  newPassword: string
): Promise<ConsumeResetResult> {
  const tokenHash = hashToken(rawToken)
  const row = await findPasswordResetByTokenHash(db, tokenHash)
  if (!row) return { kind: 'invalid' }
  if (row.usedAt) return { kind: 'used' }
  if (row.expiresAt.getTime() < Date.now()) return { kind: 'expired' }

  const user = await findUserById(db, row.userId)
  if (!user || !user.isActive) return { kind: 'user_missing' }

  const passwordHash = await hashPassword(newPassword)
  await updateUserPasswordHash(db, user.id, passwordHash)
  await markPasswordResetUsed(db, row.id)

  return { kind: 'ok' }
}
