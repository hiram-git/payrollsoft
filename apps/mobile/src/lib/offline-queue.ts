import type { PunchPayload } from '@/types/domain'
/**
 * Cola offline de marcaciones.
 *
 * Regla de oro: un punch NUNCA se pierde. Si no hay red (o el POST
 * falla por red/5xx), el punch se persiste en Capacitor Preferences y se
 * reintenta cuando vuelve la conexión.
 *
 * Idempotencia: cada item lleva una `idempotencyKey` estable generada al
 * encolar. El backend hace `INSERT ... ON CONFLICT (idempotency_key) DO
 * NOTHING`, así que reintentar el mismo punch nunca duplica filas.
 *
 * Estados:
 *  - `pending`: aún por enviar / reintentar (error de red o 5xx).
 *  - `failed` : el servidor lo rechazó con 4xx (validación, permisos).
 *    No se reintenta solo, pero se conserva visible para no perderlo.
 */
import { Preferences } from '@capacitor/preferences'
import { ApiError, apiClient } from './api-client'
import { isOnline } from './network'

const QUEUE_KEY = 'punch.queue'

export type QueueStatus = 'pending' | 'failed'

export type QueuedPunch = {
  id: string
  payload: PunchPayload
  status: QueueStatus
  attempts: number
  enqueuedAt: string
  lastError?: string
}

type Listener = (items: QueuedPunch[]) => void
const listeners = new Set<Listener>()

async function read(): Promise<QueuedPunch[]> {
  const { value } = await Preferences.get({ key: QUEUE_KEY })
  if (!value) return []
  try {
    return JSON.parse(value) as QueuedPunch[]
  } catch {
    return []
  }
}

async function write(items: QueuedPunch[]): Promise<void> {
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(items) })
  for (const l of listeners) l(items)
}

function buildIdempotencyKey(payload: PunchPayload): string {
  const ts = (payload.punchedAt ?? new Date().toISOString()).replace(/[-:.TZ]/g, '').slice(0, 14)
  const emp = (payload.employeeId ?? 'anon').slice(0, 8)
  return `mobile:${emp}:${payload.punchType}:${ts}`
}

export const punchQueue = {
  /** Suscribe la UI a cambios de la cola. Devuelve función para desuscribir. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    void read().then(listener)
    return () => listeners.delete(listener)
  },

  async list(): Promise<QueuedPunch[]> {
    return read()
  },

  async pendingCount(): Promise<number> {
    return (await read()).filter((i) => i.status === 'pending').length
  },

  /**
   * Encola un punch y dispara un flush inmediato. Devuelve el resultado
   * del intento online (si lo hubo) o indica que quedó en cola.
   */
  async enqueue(payload: PunchPayload): Promise<{ sent: boolean; queued: boolean }> {
    const punchedAt = payload.punchedAt ?? new Date().toISOString()
    const withMeta: PunchPayload = {
      ...payload,
      punchedAt,
      idempotencyKey: payload.idempotencyKey ?? buildIdempotencyKey({ ...payload, punchedAt }),
    }

    const item: QueuedPunch = {
      id: crypto.randomUUID(),
      payload: withMeta,
      status: 'pending',
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    }

    const items = await read()
    items.push(item)
    await write(items)

    const result = await punchQueue.flush()
    const stillQueued = result.remaining > 0 && (await read()).some((i) => i.id === item.id)
    return { sent: !stillQueued, queued: stillQueued }
  },

  /**
   * Intenta enviar todos los pendientes. No lanza: acumula errores en
   * cada item. Devuelve cuántos se enviaron y cuántos quedan pendientes.
   */
  async flush(): Promise<{ sent: number; remaining: number }> {
    if (!(await isOnline())) {
      const items = await read()
      return { sent: 0, remaining: items.filter((i) => i.status === 'pending').length }
    }

    const items = await read()
    let sent = 0
    const survivors: QueuedPunch[] = []

    for (const item of items) {
      if (item.status === 'failed') {
        survivors.push(item)
        continue
      }
      try {
        await apiClient.post('/attendance/punches', item.payload)
        sent++
        // Éxito → no se reencola (se descarta del survivors).
      } catch (err) {
        const isClientError = err instanceof ApiError && err.status >= 400 && err.status < 500
        survivors.push({
          ...item,
          attempts: item.attempts + 1,
          status: isClientError ? 'failed' : 'pending',
          lastError: err instanceof Error ? err.message : 'Error desconocido',
        })
      }
    }

    await write(survivors)
    return { sent, remaining: survivors.filter((i) => i.status === 'pending').length }
  },

  /** Elimina un item (p.ej. un `failed` que el usuario descarta). */
  async remove(id: string): Promise<void> {
    const items = await read()
    await write(items.filter((i) => i.id !== id))
  },
}
