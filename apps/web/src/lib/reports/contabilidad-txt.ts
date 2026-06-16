/**
 * TXT de contabilidad / devengos para Contraloría. Replica las tres secciones
 * del script legacy, agregando las planillas cerradas del mes + año (+ tipo):
 *   1) Línea de totales:     0,{entidad},{sueldo},{ss},{islr},{ss},{deducc},{neto}
 *   2) Devengos por partida: 1,{anio},{mes},{quincena},{tipnom},{entidad},{partida},{neto}
 *   3) Acreedores (ACR_*):   1,{anio},{mes},{quincena},{tipnom},{entidad},{partida},{monto},{ruc},{descrip},{forma_pago}
 * Montos en centavos (sin punto), justificados con ceros a la izquierda.
 */
import { computeBuckets, fetchGovernmentReportData } from './government-data'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const CREDITOR_PREFIX = 'ACR_'

export type ContabilidadResult =
  | { ok: true; fileName: string; content: string }
  | { ok: false; status: number; error: string }

const cents = (n: number, len: number): string =>
  String(Math.max(0, Math.round(n * 100))).padStart(len, '0')
const padR = (s: string, len: number): string => (s ?? '').slice(0, len).padEnd(len, ' ')
const partida5 = (code: string): string => (code ?? '').replace(/\./g, '').slice(0, 5).padStart(5, '0')

export async function buildContabilidadTxt(
  month: number,
  year: number,
  payrollTypeId: string | null,
  authCookie: string,
  tenantSlug: string
): Promise<ContabilidadResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': tenantSlug }

  // Planillas cerradas del mes (filtradas por tipo si aplica).
  const ids: string[] = []
  for (let page = 1; page <= 50; page++) {
    const qs = new URLSearchParams({ status: 'closed', year: String(year), page: String(page) })
    if (payrollTypeId) qs.set('payrollTypeId', payrollTypeId)
    const res = await fetch(`${API_URL}/payroll?${qs}`, { headers })
    if (res.status === 401) return { ok: false, status: 401, error: 'No autorizado' }
    if (!res.ok) return { ok: false, status: res.status, error: 'No se pudo listar planillas' }
    const json = (await res.json()) as { data?: { id: string; paymentDate: string | null }[] }
    const batch = json.data ?? []
    for (const p of batch) {
      const d = p.paymentDate ?? ''
      if (/^\d{4}-\d{2}-\d{2}/.test(d) && Number(d.slice(5, 7)) === month) ids.push(p.id)
    }
    if (batch.length < 25) break
  }
  if (ids.length === 0) {
    return { ok: false, status: 422, error: 'No hay planillas cerradas para el mes y tipo seleccionados.' }
  }

  // Totales globales + por partida + acreedores.
  const totals = { sueldo: 0, ss: 0, isr: 0, deducciones: 0, neto: 0 }
  const byPartida = new Map<string, number>()
  const byCreditor = new Map<string, number>() // concept code ACR_* → monto

  for (const id of ids) {
    const result = await fetchGovernmentReportData(id, authCookie, tenantSlug)
    if (result.kind === 'unauthorized') return { ok: false, status: 401, error: 'No autorizado' }
    if (result.kind !== 'ok') continue
    for (const group of result.data.groups) {
      for (const { line } of group.lines) {
        const b = computeBuckets(line.concepts)
        totals.sueldo += b.sueldo
        totals.ss += b.ss
        totals.isr += b.isr
        totals.deducciones += Number(line.deductions) || 0
        totals.neto += Number(line.netAmount) || 0
        byPartida.set(group.partida.code, (byPartida.get(group.partida.code) ?? 0) + (Number(line.netAmount) || 0))
        for (const c of line.concepts) {
          if (c.type === 'deduction' && c.code.startsWith(CREDITOR_PREFIX)) {
            byCreditor.set(c.code, (byCreditor.get(c.code) ?? 0) + (Number(c.amount) || 0))
          }
        }
      }
    }
    // Líneas sin partida (sin posición) cuentan en totales pero no por partida.
    for (const { line } of result.data.ungrouped) {
      const b = computeBuckets(line.concepts)
      totals.sueldo += b.sueldo
      totals.ss += b.ss
      totals.isr += b.isr
      totals.deducciones += Number(line.deductions) || 0
      totals.neto += Number(line.netAmount) || 0
      for (const c of line.concepts) {
        if (c.type === 'deduction' && c.code.startsWith(CREDITOR_PREFIX)) {
          byCreditor.set(c.code, (byCreditor.get(c.code) ?? 0) + (Number(c.amount) || 0))
        }
      }
    }
  }

  // Datos institucionales + acreedores (para ruc/descrip/forma de pago).
  let entity = ''
  const creditorMap = new Map<string, { name: string; paymentMethod: string }>()
  try {
    const [cRes, crRes] = await Promise.all([
      fetch(`${API_URL}/company`, { headers }),
      fetch(`${API_URL}/creditors?all=true`, { headers }),
    ])
    if (cRes.ok) {
      const j = (await cRes.json()) as { data?: { entityCode?: string | null } }
      entity = j.data?.entityCode ?? ''
    }
    if (crRes.ok) {
      const j = (await crRes.json()) as {
        data?: { code: string; name: string; paymentMethod?: string }[]
      }
      for (const c of j.data ?? []) {
        creditorMap.set(`${CREDITOR_PREFIX}${c.code}`, {
          name: c.name,
          paymentMethod: c.paymentMethod ?? 'check',
        })
      }
    }
  } catch {
    /* degrada: entity vacío, acreedores sin nombre */
  }

  const entity4 = (entity || '0').replace(/\D/g, '').padStart(4, '0').slice(-4)
  const quincena = 0 // consolidado mensual
  const tipnom = ''
  const out: string[] = []

  // 1) Totales
  out.push(
    `0,${entity4},${cents(totals.sueldo, 12)},${cents(totals.ss, 12)},${cents(totals.isr, 12)},${cents(totals.ss, 12)},${cents(totals.deducciones, 12)},${cents(totals.neto, 12)}`
  )

  // 2) Devengos por partida
  for (const [partida, neto] of [...byPartida.entries()].sort()) {
    out.push(`1,${year},${month},${quincena},${tipnom},${entity},${partida5(partida)},${cents(neto, 12)}`)
  }

  // 3) Acreedores (ACR_*)
  for (const [code, monto] of [...byCreditor.entries()].sort()) {
    const cr = creditorMap.get(code)
    const ruc = code.replace(CREDITOR_PREFIX, '')
    const descrip = cr?.name ?? code
    const forma = cr?.paymentMethod ?? ''
    out.push(
      `1,${year},${month},${quincena},${tipnom},${entity},${partida5('')},${cents(monto, 12)},${padR(ruc, 20)},${padR(descrip, 40)},${padR(forma, 20)}`
    )
  }

  const MES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ][month - 1]
  return {
    ok: true,
    fileName: `txt_contabilidad_${MES}_${year}.txt`,
    content: `${out.join('\r\n')}\r\n`,
  }
}
