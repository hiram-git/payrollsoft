import { DEFAULT_TENANT } from '@/config/env'
import { setUnauthorizedHandler } from '@/lib/api-client'
import * as authService from '@/lib/auth-service'
import { onConnectivityChange } from '@/lib/network'
import { punchQueue } from '@/lib/offline-queue'
import { type StoredSession, sessionStore } from '@/lib/storage'
import type { AppMode } from '@/types/domain'
/**
 * Estado de sesión global. Hidrata desde el almacenamiento al arrancar,
 * registra el manejador uniforme de 401 y dispara el flush de la cola
 * offline cuando vuelve la conexión.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type AuthState = {
  ready: boolean
  mode: AppMode | null
  tenant: string
  session: StoredSession | null
  /** Hay credencial utilizable (token Bearer o token de dispositivo). */
  hasToken: boolean
}

type AuthContextValue = AuthState & {
  isAuthenticated: boolean
  loginEmployee: typeof authService.loginEmployee
  loginKiosk: typeof authService.loginKiosk
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    mode: null,
    tenant: DEFAULT_TENANT,
    session: null,
    hasToken: false,
  })

  const refresh = useCallback(async () => {
    const [mode, tenant, session, token] = await Promise.all([
      sessionStore.getMode(),
      sessionStore.getTenant(),
      sessionStore.getSession(),
      sessionStore.getToken(),
    ])
    setState({
      ready: true,
      mode,
      tenant: tenant ?? DEFAULT_TENANT,
      session,
      hasToken: !!token,
    })
  }, [])

  const logout = useCallback(async () => {
    await authService.logout()
    await refresh()
  }, [refresh])

  // Hidratación inicial + manejador de 401 + flush al recuperar red.
  useEffect(() => {
    void refresh()
    setUnauthorizedHandler(() => {
      void logout()
    })
    const unsubscribe = onConnectivityChange((online) => {
      if (online) void punchQueue.flush()
    })
    return unsubscribe
  }, [refresh, logout])

  const loginEmployee = useCallback(
    async (...args: Parameters<typeof authService.loginEmployee>) => {
      const result = await authService.loginEmployee(...args)
      await refresh()
      return result
    },
    [refresh]
  )

  const loginKiosk = useCallback(
    async (...args: Parameters<typeof authService.loginKiosk>) => {
      const result = await authService.loginKiosk(...args)
      await refresh()
      return result
    },
    [refresh]
  )

  const isAuthenticated = !!state.mode && (state.hasToken || !!state.session?.employeeId)

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAuthenticated,
        loginEmployee,
        loginKiosk,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
