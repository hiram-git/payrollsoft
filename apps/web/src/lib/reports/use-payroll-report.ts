/**
 * Client-side state-machine composable for the Planilla PDF lifecycle.
 *
 * Despite the `use*` naming (borrowed from React) this is a vanilla-TS
 * factory: each call returns an independent controller instance, which is
 * how we drive both the detail-view dropdown and the N rows of the
 * `/reports/payroll` listing without any row affecting another.
 *
 * Lifecycle states:
 *
 *   loading  — initial read, fetching the current row from the API.
 *   idle     — read succeeded; `status` reflects server truth:
 *                'not_generated' → user can trigger Generar
 *                'generated'     → user can Descargar / Regenerar
 *   busy     — a write is in flight; `action` is 'generate' | 'regenerate'.
 *   error    — last call failed; exposes a user-friendly message and the
 *              previous known `status` (if any) so the UI can still render
 *              the right controls.
 *
 * Transitions:
 *   loading      → idle | error
 *   idle         → busy (via generate/regenerate)
 *   busy         → idle | error (via refresh after the server call)
 *   error        → busy (user retries) | loading (explicit refresh)
 */

export type ReportStatus = 'not_generated' | 'generated'

export type ReportSnapshot = {
  status: ReportStatus
  pdfPath: string | null
  generatedAt: string | null
}

export type ReportState =
  | { kind: 'loading' }
  | { kind: 'idle'; snapshot: ReportSnapshot }
  | { kind: 'busy'; action: 'generate' | 'regenerate'; lastSnapshot: ReportSnapshot | null }
  | { kind: 'error'; message: string; lastSnapshot: ReportSnapshot | null }

export type PayrollReportOptions = {
  payrollId: string
  stateUrl: string
  generateUrl: string
  regenerateUrl: string
  downloadUrl: string
}

export type PayrollReportController = {
  /** Current state snapshot — prefer `subscribe` for reactive rendering. */
  getState(): ReportState
  /**
   * Register a listener called immediately with the current state and on
   * every transition afterwards. Returns an unsubscribe function.
   */
  subscribe(listener: (state: ReportState) => void): () => void
  /** Force a state re-fetch from the server. */
  refresh(): Promise<void>
  /** Trigger the first-time generation. No-op when already `busy`. */
  generate(): Promise<void>
  /** Trigger a regeneration. No-op when already `busy`. */
  regenerate(): Promise<void>
  /** Navigate the browser to the download endpoint. */
  download(): void
  /** URLs in case the consumer prefers to render anchor tags. */
  readonly urls: {
    state: string
    generate: string
    regenerate: string
    download: string
  }
}

type ApiStateResponse = {
  data: {
    status: ReportStatus
    pdfPath: string | null
    generatedAt: string | null
  }
}

function lastSnapshotOf(state: ReportState): ReportSnapshot | null {
  if (state.kind === 'idle') return state.snapshot
  if (state.kind === 'busy' || state.kind === 'error') return state.lastSnapshot
  return null
}

export function usePayrollReport(options: PayrollReportOptions): PayrollReportController {
  let state: ReportState = { kind: 'loading' }
  const listeners = new Set<(s: ReportState) => void>()

  function set(next: ReportState) {
    state = next
    for (const fn of listeners) fn(state)
  }

  async function refresh(): Promise<void> {
    try {
      const res = await fetch(options.stateUrl, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ApiStateResponse
      set({
        kind: 'idle',
        snapshot: {
          status: json.data.status,
          pdfPath: json.data.pdfPath,
          generatedAt: json.data.generatedAt,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al leer el estado'
      set({ kind: 'error', message, lastSnapshot: lastSnapshotOf(state) })
    }
  }

  async function run(action: 'generate' | 'regenerate', url: string): Promise<void> {
    if (state.kind === 'busy') return
    set({ kind: 'busy', action, lastSnapshot: lastSnapshotOf(state) })
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'same-origin' })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(body || `Falló la generación (HTTP ${res.status})`)
      }
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error durante la generación'
      set({ kind: 'error', message, lastSnapshot: lastSnapshotOf(state) })
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh,
    generate: () => run('generate', options.generateUrl),
    regenerate: () => run('regenerate', options.regenerateUrl),
    download() {
      window.location.href = options.downloadUrl
    },
    urls: {
      state: options.stateUrl,
      generate: options.generateUrl,
      regenerate: options.regenerateUrl,
      download: options.downloadUrl,
    },
  }
}

/**
 * Convenience factory for the standard URL layout used by both the listing
 * and the detail view. Keeps the URLs centralised so renaming any endpoint
 * only requires one edit.
 */
export function payrollReportUrls(payrollId: string) {
  return {
    stateUrl: `/api/reports/payroll/${payrollId}/state`,
    generateUrl: `/api/reports/payroll/${payrollId}/generate`,
    regenerateUrl: `/api/reports/payroll/${payrollId}/regenerate`,
    downloadUrl: `/api/reports/payroll/${payrollId}/download`,
  }
}
