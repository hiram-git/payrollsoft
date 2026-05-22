/**
 * GET /api/treasury/runs/:id/checks-xlsx
 *
 * Versión Excel del flujo de impresión por corrida: descarga TODOS
 * los cheques no-anulados en una sola hoja apilada vertical, lista
 * para imprimir continuamente sobre formularios pre-impresos.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'
import { generateCheckXlsx } from '../../../../../lib/treasury/check-xlsx'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type CheckRow = {
  id: string
  checkNumber: number
  issueDate: string
  beneficiaryName: string
  amount: string
  amountInWords: string
  status: string
}

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'

  const id = params.id ?? ''
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const res = await fetch(`${API_URL}/treasury/runs/${id}/checks`, { headers })
  if (!res.ok) {
    return new Response('Corrida no encontrada', { status: res.status })
  }
  const { data } = (await res.json()) as { data: CheckRow[] }
  const printable = data.filter((c) => c.status !== 'voided')

  if (printable.length === 0) {
    return new Response('No hay cheques imprimibles en esta corrida.', { status: 404 })
  }

  const buffer = generateCheckXlsx(
    printable.map((c) => ({
      checkNumber: c.checkNumber,
      issueDate: c.issueDate,
      beneficiaryName: c.beneficiaryName,
      amount: c.amount,
      amountInWords: c.amountInWords,
    }))
  )

  for (const c of printable) {
    fetch(`${API_URL}/treasury/checks/${c.id}/print`, {
      method: 'POST',
      headers,
    }).catch(() => {})
  }

  const filename = `cheques-corrida-${id.slice(0, 8)}.xlsx`
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
