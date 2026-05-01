/**
 * HTML + plain-text bodies for the payroll payslip email. Stays
 * deliberately minimal — the actual numbers live in the attached PDF.
 *
 * Inline styles only because most email clients strip <style> blocks.
 * Colours mirror the design-system navy (#003087) so the message
 * keeps the brand identity even outside the product.
 */

export type PayslipEmailParams = {
  /** Greeting first-line: "Hola Juan Pérez,". */
  employeeName: string
  /** Payroll display name (e.g. "Quincenal 2026-04-30"). */
  payrollName: string
  /** Period bounds for context. ISO strings (`YYYY-MM-DD`). */
  periodStart: string
  periodEnd: string
  /** Optional payment date displayed when present. */
  paymentDate: string | null
  /** Net amount paid, pre-formatted (e.g. "1,234.56"). */
  netAmount: string
  /** Currency symbol from company config (default "$"). */
  currencySymbol?: string
  /** Tenant company name shown in the header / footer. */
  companyName: string | null
}

export type PayslipEmail = {
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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

export function buildPayslipEmail(params: PayslipEmailParams): PayslipEmail {
  const symbol = params.currencySymbol ?? '$'
  const safeName = escapeHtml(params.employeeName)
  const safeCompany = escapeHtml(params.companyName ?? 'PayrollSoft')
  const safePayroll = escapeHtml(params.payrollName)
  const period = `${formatDate(params.periodStart)} → ${formatDate(params.periodEnd)}`
  const paymentLine = params.paymentDate
    ? `Fecha de pago: <strong>${escapeHtml(formatDate(params.paymentDate))}</strong>`
    : null
  const year = new Date().getFullYear()

  const subject = `Comprobante de pago — ${params.payrollName}`

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
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="40" height="40" align="center" valign="middle" style="background:#003087;border-radius:6px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:40px;">P</td>
                  <td style="padding-left:14px;">
                    <div style="font-weight:600;color:#0c1424;font-size:14px;letter-spacing:0.01em;">${safeCompany}</div>
                    <div style="font-size:11px;color:#7a8499;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px;">PayrollSoft · Comprobante</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 40px;">
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:300;font-size:30px;line-height:1.15;color:#0c1424;letter-spacing:-0.02em;margin:24px 0 12px 0;">Tu comprobante de pago</h1>
              <p style="color:#2a3346;font-size:15px;line-height:1.6;margin:0 0 18px 0;">
                Hola ${safeName},<br/>
                Adjuntamos tu comprobante correspondiente a la planilla <strong>${safePayroll}</strong>.
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-top:1px solid #e4e7ee;border-bottom:1px solid #e4e7ee;margin:8px 0 24px 0;">
                <tr>
                  <td style="padding:12px 0;color:#7a8499;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;width:40%;">Período</td>
                  <td style="padding:12px 0;color:#0c1424;font-size:13px;font-family:'JetBrains Mono','Menlo',monospace;">${escapeHtml(period)}</td>
                </tr>
                ${paymentLine ? `<tr><td style="padding:12px 0;color:#7a8499;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;border-top:1px solid #f1f3f7;">Pago</td><td style="padding:12px 0;color:#0c1424;font-size:13px;border-top:1px solid #f1f3f7;">${paymentLine}</td></tr>` : ''}
                <tr>
                  <td style="padding:12px 0;color:#7a8499;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;border-top:1px solid #f1f3f7;">Neto a pagar</td>
                  <td style="padding:12px 0;color:#047857;font-size:18px;font-weight:600;border-top:1px solid #f1f3f7;font-family:'JetBrains Mono','Menlo',monospace;">${symbol}${escapeHtml(params.netAmount)}</td>
                </tr>
              </table>

              <p style="color:#2a3346;font-size:13px;line-height:1.6;margin:0 0 6px 0;">
                El detalle completo de ingresos y deducciones está en el archivo PDF adjunto.
              </p>
              <p style="color:#7a8499;font-size:12px;line-height:1.55;margin:16px 0 0 0;">
                Si crees que recibiste este correo por error, por favor contacta a Recursos Humanos.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px 28px 40px;border-top:1px solid #e4e7ee;color:#7a8499;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-family:'JetBrains Mono','Menlo',monospace;">
              © ${year} ${safeCompany} · Confidencial
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
    `Hola ${params.employeeName},`,
    '',
    `Adjuntamos tu comprobante de pago correspondiente a la planilla ${params.payrollName}.`,
    '',
    `Período: ${formatDate(params.periodStart)} → ${formatDate(params.periodEnd)}`,
    params.paymentDate ? `Fecha de pago: ${formatDate(params.paymentDate)}` : null,
    `Neto a pagar: ${symbol}${params.netAmount}`,
    '',
    'El detalle completo está en el archivo PDF adjunto.',
    '',
    `© ${year} ${params.companyName ?? 'PayrollSoft'}`,
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, html, text }
}
