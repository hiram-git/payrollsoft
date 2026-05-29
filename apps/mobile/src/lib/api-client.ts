import { API_URL } from '@/config/env'
import type { AppMode } from '@/types/domain'
/**
 * Cliente HTTP compartido. Único punto que habla con la API Elysia.
 *
 * Responsabilidades:
 *  - Centralizar `API_URL`.
 *  - Inyectar `X-Tenant` en todo request.
 *  - Inyectar la credencial según el modo:
 *      · empleado/supervisor → `Authorization: Bearer <jwt>`
 *      · kiosko              → `X-Device-Token <apiToken>` (lo que hoy
 *        acepta `POST /attendance/punches` end-to-end).
 *  - Manejar 401 de forma uniforme (callback → fuerza logout en la UI).
 *  - Tipar respuestas con `ApiResponse<T>` de `@payroll/types`.
 *
 * ⚠️ Bearer en rutas de attendance/portal: el backend HOY solo lee la
 * cookie `auth`/`portal_auth`, no el header `Authorization`. Por eso el
 * modo empleado no es funcional end-to-end todavía. El cliente ya envía
 * el header correcto; el cambio mínimo en backend está documentado en
 * NOTES.md § "Bearer auth".
 */
import type { ApiResponse } from '@payroll/types'
import { sessionStore } from './storage'

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

/** Se dispara en cualquier 401 para que la app limpie sesión y redirija. */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler = () => {}

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  /** Permite forzar credenciales (p.ej. el propio login, que aún no tiene token). */
  skipAuth?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function authHeaders(mode: AppMode | null, token: string | null): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!token) return headers
  // El kiosko se autentica como dispositivo; los demás como portador JWT.
  if (mode === 'kiosk') headers['X-Device-Token'] = token
  else headers.Authorization = `Bearer ${token}`
  return headers
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, skipAuth } = options

  const tenant = (await sessionStore.getTenant()) ?? ''
  const token = skipAuth ? null : await sessionStore.getToken()
  const mode = await sessionStore.getMode()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant': tenant,
    // Marca el request como cliente nativo: el backend devuelve el JWT en
    // el body del login (no solo cookie httpOnly) y habilita Bearer.
    'X-Client': 'mobile',
    ...authHeaders(mode, token),
  }

  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    // Error de red (sin conexión, DNS, CORS). Siempre explícito.
    throw new ApiError(
      err instanceof Error ? err.message : 'No se pudo conectar con el servidor',
      0
    )
  }

  if (res.status === 401) {
    onUnauthorized()
    throw new ApiError('Sesión expirada. Inicia sesión de nuevo.', 401)
  }

  const text = await res.text()
  let json: ApiResponse<T> | undefined
  try {
    json = text ? (JSON.parse(text) as ApiResponse<T>) : undefined
  } catch {
    throw new ApiError('Respuesta del servidor no válida', res.status, text)
  }

  if (!res.ok || (json && json.success === false)) {
    const message = json && json.success === false ? json.error : `Error ${res.status} del servidor`
    throw new ApiError(
      message,
      res.status,
      json && json.success === false ? json.details : undefined
    )
  }

  if (!json || json.success !== true) {
    throw new ApiError('Respuesta del servidor incompleta', res.status, json)
  }

  return json.data
}

export const apiClient = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
