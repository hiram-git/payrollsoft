/**
 * Orígenes permitidos para CORS y CSRF.
 *
 * El navegador (web) usa `WEB_URL`. El app móvil de Capacitor hace
 * requests cross-origin desde esquemas nativos (`capacitor://localhost`
 * en iOS, `https://localhost` en Android con `androidScheme: https`,
 * `ionic://localhost`), y necesita autenticarse por Bearer en vez de
 * cookie. Esos orígenes nativos se permiten siempre; orígenes extra
 * (p.ej. el dev server del móvil) se añaden por `MOBILE_ORIGINS`.
 *
 * Este módulo es la única fuente de verdad de "qué origin es de
 * confianza", consumida tanto por el plugin de CORS como por el de CSRF.
 */
import { env } from './env'

/** Esquemas nativos de Capacitor/Ionic. Sin puerto ni path. */
const NATIVE_ORIGINS = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
] as const

/** En desarrollo se permite cualquier puerto de localhost (Vite, etc.). */
const DEV_LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const configuredOrigins = (env.MOBILE_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean)

const staticAllowed = new Set<string>([
  env.WEB_URL.replace(/\/$/, ''),
  ...NATIVE_ORIGINS,
  ...configuredOrigins,
])

/** True si el origin recibido es de confianza (web, nativo o configurado). */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  const normalized = origin.replace(/\/$/, '')
  if (staticAllowed.has(normalized)) return true
  if (env.NODE_ENV !== 'production' && DEV_LOCALHOST.test(normalized)) return true
  return false
}
