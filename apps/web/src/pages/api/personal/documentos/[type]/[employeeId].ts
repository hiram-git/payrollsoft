import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'
import {
  type CompanyForDoc,
  DOCUMENT_LABELS,
  type DocumentType,
  type EmployeeForDoc,
  buildEmployeeDocument,
} from '../../../../../lib/docs/employee-docs'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const VALID_TYPES = new Set<DocumentType>(['contrato', 'certificacion', 'carta'])

/**
 * Genera y descarga un documento Word para un empleado:
 *   GET /api/personal/documentos/contrato/<employeeId>
 *   GET /api/personal/documentos/certificacion/<employeeId>
 *   GET /api/personal/documentos/carta/<employeeId>
 *
 * Hace dos fetches al API: el empleado y la configuración de la empresa,
 * y arma el .docx en memoria con la lib `docx`. El nombre del archivo se
 * compone como `<tipo>-<código>-<apellido>.docx` para facilitar
 * organizarlos por carpeta cuando se descargan varios.
 */
export const GET: APIRoute = async ({ params, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })

  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const type = params.type as DocumentType | undefined
  const employeeId = params.employeeId
  if (!type || !VALID_TYPES.has(type)) {
    return new Response('Tipo de documento inválido', { status: 400 })
  }
  if (!employeeId) {
    return new Response('Empleado requerido', { status: 400 })
  }

  let employee: EmployeeForDoc
  let company: CompanyForDoc
  try {
    const [empRes, compRes] = await Promise.all([
      fetch(`${API_URL}/employees/${employeeId}`, { headers }),
      fetch(`${API_URL}/company`, { headers }),
    ])
    if (empRes.status === 404) return new Response('Empleado no encontrado', { status: 404 })
    if (!empRes.ok) {
      return new Response(`No se pudo cargar el empleado (HTTP ${empRes.status}).`, { status: 502 })
    }
    const empJson = (await empRes.json()) as { data: EmployeeForDoc }
    employee = empJson.data
    company = compRes.ok
      ? ((await compRes.json()) as { data: CompanyForDoc }).data
      : ({
          companyName: null,
          ruc: null,
          address: null,
        } as CompanyForDoc)
  } catch (err) {
    return new Response(
      `Error al cargar datos: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    )
  }

  let buffer: Buffer
  try {
    buffer = await buildEmployeeDocument(type, employee, company)
  } catch (err) {
    return new Response(
      `Error al generar el documento: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 }
    )
  }

  // `[^a-z0-9]+` already collapses any non-ASCII (including combining
  // diacritics from "Pérez" → "p-rez") into dashes, so we don't need a
  // separate NFD + strip-marks step.
  const safeName = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'empleado'

  const filename = `${type}-${safeName(employee.code ?? '')}-${safeName(
    employee.lastName ?? ''
  )}.docx`

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
      'X-Document-Label': DOCUMENT_LABELS[type],
    },
  })
}
