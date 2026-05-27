import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'

/**
 * Devuelve un archivo .xlsx con la cabecera de columnas esperadas por
 * el importador y una fila de ejemplo, para que el usuario sepa la
 * estructura sin tener que adivinar nombres.
 *
 * Las celdas de fecha se escriben como Date para que Excel las muestre
 * con formato fecha en vez de un serial numérico.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })

  const headers = [
    'code',
    'firstName',
    'lastName',
    'idNumber',
    'hireDate',
    'baseSalary',
    'email',
    'phone',
    'socialSecurityNumber',
    'cargoCode',
    'funcionCode',
    'departamentoCode',
    'positionCode',
    'payFrequency',
  ]

  const exampleRow: Record<string, unknown> = {
    code: 'E001',
    firstName: 'María',
    lastName: 'Pérez',
    idNumber: '8-123-456',
    hireDate: new Date('2026-01-15'),
    baseSalary: 850.0,
    email: 'maria.perez@empresa.com',
    phone: '6000-0000',
    socialSecurityNumber: '1234567',
    cargoCode: 'GERENTE',
    funcionCode: '',
    departamentoCode: 'VENTAS',
    positionCode: '',
    payFrequency: 'biweekly',
  }

  const ws = XLSX.utils.json_to_sheet([exampleRow], { header: headers })
  // Anchos cómodos para que el usuario lea sin tener que redimensionar.
  ws['!cols'] = headers.map((h) => ({
    wch: Math.max(h.length + 2, 14),
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Empleados')

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-empleados.xlsx"',
      'Content-Length': String(buffer.byteLength),
    },
  })
}
