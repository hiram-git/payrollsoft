import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

type ApiEmployee = {
  code: string
  firstName: string
  lastName: string
  idNumber: string | null
  department: string | null
  position: string | null
  birthDate: string | null
  isActive: boolean
}

/**
 * Reporte de cumpleañeros del mes en Excel. Agrega los empleados cuyo
 * mes de nacimiento coincide con el seleccionado, ordenados por día.
 * Respeta el tipo de planilla y la situación del listado de personal.
 */
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  const now = new Date()
  let month = Number(url.searchParams.get('month'))
  if (!Number.isInteger(month) || month < 1 || month > 12) month = now.getUTCMonth() + 1

  const payrollTypeId =
    url.searchParams.get('payrollTypeId') || (cookies.get('payroll.activeTypeId')?.value ?? '')
  const sit = url.searchParams.get('situacion')
  const situacion: 'active' | 'inactive' | 'all' =
    sit === 'inactive' ? 'inactive' : sit === 'all' ? 'all' : 'active'

  const PAGE_SIZE = 100
  const MAX_PAGES = 50
  const rows: ApiEmployee[] = []
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (situacion === 'active') params.set('isActive', 'true')
      else if (situacion === 'inactive') params.set('isActive', 'false')
      if (payrollTypeId) params.set('payrollTypeId', payrollTypeId)
      const res = await fetch(`${API_URL}/employees?${params}`, { headers })
      if (res.status === 401) return redirect('/login')
      if (!res.ok) return new Response('Error al cargar empleados', { status: res.status })
      const json = (await res.json()) as { data: ApiEmployee[] }
      const batch = json.data ?? []
      rows.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
  } catch {
    return new Response('No se pudo conectar con el servidor', { status: 502 })
  }

  const currentYear = now.getUTCFullYear()
  const people = rows
    .map((e) => {
      const bd = e.birthDate ? String(e.birthDate).slice(0, 10) : ''
      return { e, bd }
    })
    .filter(({ bd }) => /^\d{4}-\d{2}-\d{2}$/.test(bd) && Number(bd.slice(5, 7)) === month)
    .map(({ e, bd }) => ({
      day: Number(bd.slice(8, 10)),
      age: currentYear - Number(bd.slice(0, 4)),
      bd,
      e,
    }))
    .sort((a, b) => a.day - b.day || a.e.lastName.localeCompare(b.e.lastName, 'es'))

  const aoa: (string | number)[][] = [
    [`Cumpleañeros de ${MESES[month - 1]}`],
    ['Día', 'Código', 'Nombre', 'Cédula', 'Departamento', 'Cargo', 'Fecha de nacimiento', 'Edad'],
    ...people.map((p) => [
      p.day,
      p.e.code,
      `${p.e.firstName} ${p.e.lastName}`,
      p.e.idNumber ?? '',
      p.e.department ?? '',
      p.e.position ?? '',
      p.bd,
      p.age,
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 28 }, { wch: 14 },
    { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 7 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cumpleañeros')
  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const fileName = `cumpleaneros_${MESES[month - 1].toLowerCase()}_${currentYear}.xlsx`
  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
