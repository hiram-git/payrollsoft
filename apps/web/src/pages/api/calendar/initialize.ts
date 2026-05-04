import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type Shift = { id: string; name: string; weekdays: number[] }

/**
 * Wizard proxy for /config/calendars. Maps the form's three preset
 * options (standard, extended, custom) to one or more shift ids that
 * /calendar/initialize on the API understands.
 *
 * - "standard" / "extended" auto-create their backing shifts on first
 *   use so the operator doesn't have to seed them by hand.
 * - "custom" reuses whatever the user ticked in the wizard.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }
  const json = (extra: HeadersInit = {}) => ({
    'Content-Type': 'application/json',
    ...headers,
    ...extra,
  })

  const form = await request.formData()
  const year = Number.parseInt(String(form.get('year') ?? ''), 10)
  if (!Number.isInteger(year)) {
    return redirect(`/config/calendars?error=1&detail=${encodeURIComponent('Año inválido')}`)
  }

  const scope = String(form.get('scope') ?? 'full')
  const months =
    scope === 'months'
      ? form
          .getAll('months')
          .map((v) => Number.parseInt(String(v), 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
      : undefined
  if (scope === 'months' && (!months || months.length === 0)) {
    return redirect(
      `/config/calendars?error=1&detail=${encodeURIComponent('Selecciona al menos un mes')}`
    )
  }

  const schedule = String(form.get('schedule') ?? 'standard')

  let shiftIds: string[] = []
  try {
    if (schedule === 'custom') {
      shiftIds = form.getAll('customShiftIds').map((v) => String(v))
      if (shiftIds.length === 0) {
        return redirect(
          `/config/calendars?error=1&detail=${encodeURIComponent('Selecciona al menos un turno personalizado')}`
        )
      }
    } else {
      shiftIds = await ensurePresetShifts(schedule, headers, json)
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'No se pudieron preparar los turnos'
    return redirect(`/config/calendars?error=1&detail=${encodeURIComponent(detail)}`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/calendar/initialize`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ year, months, shiftIds }),
    })
  } catch (err) {
    console.error('[calendar/initialize] fetch failed:', err)
    return redirect('/config/calendars?error=1&detail=server-error')
  }

  if (!res.ok) {
    let detail = 'server-error'
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      detail = body.message ?? body.error ?? 'server-error'
    } catch {}
    return redirect(`/config/calendars?error=1&detail=${encodeURIComponent(detail)}`)
  }

  return redirect('/config/calendars?flash=initialized')
}

/**
 * Find or create the backing shifts for the "standard" and "extended"
 * presets. Matches by name first; if no row exists with that name the
 * proxy POSTs a new one. Idempotent on every wizard run.
 */
async function ensurePresetShifts(
  schedule: string,
  headers: Record<string, string>,
  json: (extra?: HeadersInit) => Record<string, string>
): Promise<string[]> {
  const listRes = await fetch(`${API_URL}/attendance/shifts`, { headers })
  if (!listRes.ok) throw new Error('No se pudieron listar los turnos existentes')
  const existing = ((await listRes.json()) as { data: Shift[] }).data ?? []

  const findOrCreate = async (name: string, payload: Record<string, unknown>): Promise<string> => {
    const hit = existing.find((s) => s.name === name)
    if (hit) {
      // Make sure the weekdays array is current — the user might have
      // edited the shift between wizard runs.
      await fetch(`${API_URL}/attendance/shifts/${hit.id}`, {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify({ weekdays: payload.weekdays }),
      })
      return hit.id
    }
    const res = await fetch(`${API_URL}/attendance/shifts`, {
      method: 'POST',
      headers: json(),
      body: JSON.stringify({ name, ...payload }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      throw new Error(body.message ?? `No se pudo crear el turno "${name}"`)
    }
    const created = (await res.json()) as { data: Shift }
    return created.data.id
  }

  if (schedule === 'standard') {
    const id = await findOrCreate('Estándar L-V', {
      entryTime: '08:00',
      lunchStartTime: '12:00',
      lunchEndTime: '13:00',
      exitTime: '17:00',
      weekdays: [1, 2, 3, 4, 5],
    })
    return [id]
  }

  if (schedule === 'extended') {
    const lv = await findOrCreate('Extendido L-V', {
      entryTime: '08:00',
      lunchStartTime: '12:00',
      lunchEndTime: '13:00',
      exitTime: '17:00',
      weekdays: [1, 2, 3, 4, 5],
    })
    const sat = await findOrCreate('Extendido Sábado', {
      entryTime: '08:00',
      exitTime: '13:00',
      weekdays: [6],
    })
    return [lv, sat]
  }

  throw new Error(`Tipo de horario desconocido: ${schedule}`)
}
