/**
 * Estado de conectividad sobre el plugin Network de Capacitor.
 * Centraliza la consulta para que la cola offline y la UI compartan
 * una sola fuente de verdad.
 */
import { Network } from '@capacitor/network'

export async function isOnline(): Promise<boolean> {
  try {
    const status = await Network.getStatus()
    return status.connected
  } catch {
    // En web/dev el plugin puede no estar disponible: asumir online.
    return true
  }
}

/**
 * Suscribe un callback a los cambios de conectividad. Devuelve una
 * función para desuscribir. Si el plugin falla (web), no hace nada.
 */
export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  const handlePromise = Network.addListener('networkStatusChange', (status) => {
    cb(status.connected)
  }).catch(() => null)

  return () => {
    handlePromise.then((handle) => handle?.remove()).catch(() => {})
  }
}
