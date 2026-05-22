/**
 * GET /api/treasury/checks/:id/xlsx
 *
 * Genera el cheque en formato Excel posicional (replica del flujo
 * PHP/PHPExcel del sistema legacy). Devuelve el .xlsx como descarga
 * y marca el cheque como `printed` en el API.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'
import { generateCheckXlsx } from '../../../../../lib/treasury/check-xlsx'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'

  const id = params.id ?? ''
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const res = await fetch(`${API_URL}/treasury/checks/${id}`, { headers })
  if (!res.ok) {
    return new Response('Cheque no encontrado', { status: res.status })
  }
  const { data } = (await res.json()) as {
    data: {
      check: {
        checkNumber: number
        issueDate: string
        beneficiaryName: string
        amount: string
        amountInWords: string
      }
    }
  }

  const buffer = generateCheckXlsx([
    {
      checkNumber: data.check.checkNumber,
      issueDate: data.check.issueDate,
      beneficiaryName: data.check.beneficiaryName,
      amount: data.check.amount,
      amountInWords: data.check.amountInWords,
    },
  ])

  fetch(`${API_URL}/treasury/checks/${id}/print`, { method: 'POST', headers }).catch(() => {})

  const filename = `cheque-${String(data.check.checkNumber).padStart(7, '0')}.xlsx`
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
