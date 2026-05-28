/**
 * Servicio de autenticación de los tres modos.
 *
 *  - Empleado  : POST /portal/auth/login (idNumber + password). FUNCIONAL
 *    salvo que el backend aún no devuelve el JWT en el body ni lee el
 *    header Authorization (ver NOTES.md § "Bearer auth"). El cliente ya
 *    está cableado para el día que el backend entregue el token.
 *  - Kiosko    : token de dispositivo (apiToken generado al crear el
 *    device en /attendance/devices). FUNCIONAL end-to-end: el backend
 *    acepta X-Device-Token en POST /attendance/punches hoy mismo.
 *  - Supervisor: STUB. Usaría /auth/login (usuario tenant) y tiene el
 *    mismo bloqueo de Bearer que el empleado. Esbozado, no funcional.
 */
import { apiClient } from './api-client'
import { missingRequiredFields } from './forms'
import { type StoredSession, sessionStore } from './storage'

/**
 * Forma esperada de la respuesta de /portal/auth/login.
 * `token` es OPCIONAL a propósito: hoy el backend no lo manda (lo setea
 * como cookie httpOnly). Cuando se aplique el cambio de NOTES.md, este
 * campo empezará a llegar y el flujo quedará 100% funcional sin tocar
 * el cliente.
 */
type PortalLoginData =
  | { employeeId: string; code: string; name: string; token?: string }
  | undefined

export type EmployeeLoginResult = {
  session: StoredSession
  /** true si el login fue válido pero el backend no entregó token Bearer. */
  bearerMissing: boolean
}

export async function loginEmployee(
  idNumber: string,
  password: string,
  tenant: string
): Promise<EmployeeLoginResult> {
  const missing = missingRequiredFields(['idNumber', 'password'], { idNumber, password })
  if (missing.length > 0) {
    throw new Error('Cédula y contraseña son obligatorias.')
  }

  // El tenant debe estar disponible antes del request (lo inyecta el
  // cliente como X-Tenant). Se persiste primero.
  await sessionStore.setTenant(tenant)
  await sessionStore.setMode('employee')

  const data = await apiClient.post<PortalLoginData>(
    '/portal/auth/login',
    { idNumber: idNumber.trim(), password },
    { skipAuth: true }
  )

  const session: StoredSession = data
    ? { employeeId: data.employeeId, employeeCode: data.code, name: data.name }
    : {}
  await sessionStore.setSession(session)

  const token = data?.token
  if (token) {
    await sessionStore.setToken(token)
    return { session, bearerMissing: false }
  }

  // Login validado pero sin token utilizable por el cliente nativo.
  return { session, bearerMissing: true }
}

/**
 * Login de kiosko: el dispositivo se autentica con su apiToken. No hay
 * usuario; el token identifica al device y el backend confía en el
 * employeeId que se le envíe (identificado por facial/NFC — TODO).
 */
export async function loginKiosk(deviceToken: string, tenant: string): Promise<void> {
  const missing = missingRequiredFields(['deviceToken', 'tenant'], { deviceToken, tenant })
  if (missing.length > 0) {
    throw new Error('Token del dispositivo y tenant son obligatorios.')
  }
  await sessionStore.setTenant(tenant.trim())
  await sessionStore.setMode('kiosk')
  await sessionStore.setToken(deviceToken.trim())
}

/**
 * STUB de login de supervisor (usuario tenant).
 *
 * TODO: autenticar contra POST /auth/login (email + password) y guardar
 * el JWT como Bearer. Bloqueado por el mismo gap que el empleado: el
 * backend responde con cookie httpOnly y no lee Authorization. Ver
 * NOTES.md § "Bearer auth".
 */
export async function loginSupervisor(_email: string, _password: string): Promise<never> {
  throw new Error(
    'Modo Supervisor no implementado todavía (pendiente de Bearer auth en el backend). Ver NOTES.md.'
  )
}

export async function logout(): Promise<void> {
  await sessionStore.clear()
}
