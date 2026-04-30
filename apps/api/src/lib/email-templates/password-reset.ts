/**
 * HTML + plain-text bodies for the "restablece tu contraseña" email.
 *
 * Inline styles only — most email clients strip <style> blocks. Colours
 * mirror the design system's navy + light surface palette so the email
 * feels like part of the product (not a generic transactional notice).
 */

export type PasswordResetEmailParams = {
  resetUrl: string
  userName: string | null
  companyName: string | null
  expiresInMinutes: number
}

export type PasswordResetEmail = {
  subject: string
  html: string
  text: string
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildPasswordResetEmail(params: PasswordResetEmailParams): PasswordResetEmail {
  const { resetUrl, userName, companyName, expiresInMinutes } = params
  const safeUrl = escapeHtml(resetUrl)
  const safeName = userName ? escapeHtml(userName) : null
  const safeCompany = escapeHtml(companyName ?? 'PayrollSoft')
  const year = new Date().getFullYear()
  const greeting = safeName ? `Hola ${safeName},` : 'Hola,'

  const subject = 'Restablece tu contraseña — PayrollSoft'

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0c1424;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e7ee;border-radius:12px;overflow:hidden;">
          <!-- Header / brand -->
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="40" height="40" align="center" valign="middle" style="background:#003087;border-radius:6px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:40px;">P</td>
                  <td style="padding-left:14px;">
                    <div style="font-weight:600;color:#0c1424;font-size:14px;letter-spacing:0.01em;">${safeCompany}</div>
                    <div style="font-size:11px;color:#7a8499;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px;">PayrollSoft · Recuperación</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:8px 40px 8px 40px;">
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:300;font-size:30px;line-height:1.15;color:#0c1424;letter-spacing:-0.02em;margin:24px 0 12px 0;">Restablece tu contraseña</h1>
              <p style="color:#2a3346;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
                ${greeting}<br/>
                Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón a continuación para crear una nueva contraseña.
              </p>
              <p style="color:#2a3346;font-size:14px;line-height:1.6;margin:0 0 24px 0;">
                Por seguridad, este enlace expirará en <strong>${expiresInMinutes} minutos</strong> y solo puede usarse una vez.
              </p>

              <!-- CTA button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px 0;">
                <tr>
                  <td bgcolor="#003087" style="border-radius:3px;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:500;letter-spacing:0.02em;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Restablecer contraseña</a>
                  </td>
                </tr>
              </table>

              <p style="color:#7a8499;font-size:13px;line-height:1.55;margin:0 0 8px 0;">
                Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña actual seguirá funcionando.
              </p>
              <p style="color:#7a8499;font-size:12px;line-height:1.55;margin:16px 0 0 0;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="margin:6px 0 24px 0;word-break:break-all;font-family:'JetBrains Mono','Menlo',monospace;font-size:12px;color:#5b6478;">
                ${safeUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px 40px;border-top:1px solid #e4e7ee;color:#7a8499;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-family:'JetBrains Mono','Menlo',monospace;">
              © ${year} ${safeCompany} · Acceso seguro
            </td>
          </tr>
        </table>

        <p style="color:#9ba3b4;font-size:11px;font-family:'JetBrains Mono','Menlo',monospace;letter-spacing:0.1em;text-transform:uppercase;margin:16px 0 0 0;">
          Este correo se envió automáticamente, por favor no responder.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    greeting.replace(/<[^>]+>/g, ''),
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
    `Abre el siguiente enlace para crear una nueva contraseña (expira en ${expiresInMinutes} minutos):`,
    '',
    resetUrl,
    '',
    'Si no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá funcionando.',
    '',
    `© ${year} ${companyName ?? 'PayrollSoft'}`,
  ].join('\n')

  return { subject, html, text }
}
