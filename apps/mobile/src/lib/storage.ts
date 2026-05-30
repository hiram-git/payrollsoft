import type { AppMode } from '@/types/domain'
/**
 * Almacenamiento de sesión.
 *
 * Usa Capacitor Preferences como base. ⚠️ Preferences NO está cifrado
 * (UserDefaults / SharedPreferences en claro). Para producción, el token
 * debe migrarse a un plugin de Keychain/Keystore (ver NOTES.md §
 * "Almacenamiento seguro"). Se centraliza aquí para que ese cambio sea
 * de un solo archivo.
 */
import { Preferences } from '@capacitor/preferences'

const KEYS = {
  token: 'auth.token',
  tenant: 'auth.tenant',
  mode: 'auth.mode',
  session: 'auth.session',
} as const

/** Datos no sensibles de la sesión, para hidratar la UI sin re-login. */
export type StoredSession = {
  employeeId?: string
  employeeCode?: string
  name?: string
}

async function get(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key })
  return value
}

async function set(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value })
}

async function remove(key: string): Promise<void> {
  await Preferences.remove({ key })
}

export const sessionStore = {
  async getToken(): Promise<string | null> {
    return get(KEYS.token)
  },
  async setToken(token: string): Promise<void> {
    await set(KEYS.token, token)
  },

  async getTenant(): Promise<string | null> {
    return get(KEYS.tenant)
  },
  async setTenant(tenant: string): Promise<void> {
    await set(KEYS.tenant, tenant)
  },
  async clearTenant(): Promise<void> {
    await remove(KEYS.tenant)
  },

  async getMode(): Promise<AppMode | null> {
    return (await get(KEYS.mode)) as AppMode | null
  },
  async setMode(mode: AppMode): Promise<void> {
    await set(KEYS.mode, mode)
  },

  async getSession(): Promise<StoredSession | null> {
    const raw = await get(KEYS.session)
    if (!raw) return null
    try {
      return JSON.parse(raw) as StoredSession
    } catch {
      return null
    }
  },
  async setSession(session: StoredSession): Promise<void> {
    await set(KEYS.session, JSON.stringify(session))
  },

  /** Borra todo: token, sesión y modo. El logout llama esto. */
  async clear(): Promise<void> {
    await Promise.all([remove(KEYS.token), remove(KEYS.session), remove(KEYS.mode)])
    // El tenant se conserva: facilita el siguiente login en el mismo
    // dispositivo. Se sobrescribe en el próximo login si cambia.
  },
}
