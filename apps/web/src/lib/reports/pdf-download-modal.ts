/**
 * Shared loading-modal helper for any on-demand PDF or report flow.
 *
 * The modal blocks the screen while the browser fetches PDF bytes from
 * the server, or while a long-running write (generate / regenerate)
 * runs against the API. Surfacing it consistently across pages keeps
 * the user from clicking again, and the explicit success transition at
 * the end gives them a clear "the work finished" signal before the
 * modal vanishes.
 *
 * The modal is lazy-injected into the DOM on first use so it lives in
 * exactly one place regardless of which page imports the helper —
 * keeping the visuals consistent across `/payroll/[id]`, `/reports/
 * payroll`, `/reports/personal` and any future report flow.
 */
const MODAL_ID = 'payroll-pdf-loading-modal'
const TITLE_SELECTOR = '[data-modal-title]'
const SUBTITLE_SELECTOR = '[data-modal-subtitle]'
const SPINNER_SELECTOR = '[data-modal-spinner]'
const CHECK_SELECTOR = '[data-modal-check]'

const DEFAULT_LOADING_TITLE = 'Generando PDF'
const DEFAULT_LOADING_SUBTITLE = 'Esto puede tardar unos segundos…'
const DEFAULT_SUCCESS_SUBTITLE = 'Listo'
const SUCCESS_DISPLAY_MS = 1400

function ensureModal(): HTMLElement {
  const existing = document.getElementById(MODAL_ID)
  if (existing) return existing

  const modal = document.createElement('div')
  modal.id = MODAL_ID
  modal.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-live', 'polite')
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <div class="relative bg-white rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 min-w-[280px]">
      <svg data-modal-spinner class="w-10 h-10 animate-spin text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
      <svg data-modal-check class="hidden w-10 h-10 text-emerald-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9.5"/></svg>
      <p class="text-sm font-semibold text-gray-900" data-modal-title>${DEFAULT_LOADING_TITLE}</p>
      <p class="text-xs text-gray-500" data-modal-subtitle>${DEFAULT_LOADING_SUBTITLE}</p>
    </div>
  `
  document.body.appendChild(modal)
  return modal
}

function setLoadingState(modal: HTMLElement, title: string, subtitle = DEFAULT_LOADING_SUBTITLE) {
  const titleEl = modal.querySelector<HTMLElement>(TITLE_SELECTOR)
  const subEl = modal.querySelector<HTMLElement>(SUBTITLE_SELECTOR)
  const spinner = modal.querySelector<HTMLElement>(SPINNER_SELECTOR)
  const check = modal.querySelector<HTMLElement>(CHECK_SELECTOR)
  if (titleEl) titleEl.textContent = title
  if (subEl) subEl.textContent = subtitle
  spinner?.classList.remove('hidden')
  check?.classList.add('hidden')
}

function setSuccessState(modal: HTMLElement, title: string, subtitle = DEFAULT_SUCCESS_SUBTITLE) {
  const titleEl = modal.querySelector<HTMLElement>(TITLE_SELECTOR)
  const subEl = modal.querySelector<HTMLElement>(SUBTITLE_SELECTOR)
  const spinner = modal.querySelector<HTMLElement>(SPINNER_SELECTOR)
  const check = modal.querySelector<HTMLElement>(CHECK_SELECTOR)
  if (titleEl) titleEl.textContent = title
  if (subEl) subEl.textContent = subtitle
  spinner?.classList.add('hidden')
  check?.classList.remove('hidden')
}

/** Open the modal in its loading state. Subsequent calls update the heading. */
export function openLoadingModal(title: string, subtitle?: string): void {
  const modal = ensureModal()
  setLoadingState(modal, title, subtitle)
  modal.classList.remove('hidden')
}

/**
 * Swap the modal to its success state and auto-close after a short
 * "checkmark" pause (1.4s by default). Returns the timer id so callers
 * can cancel it if a follow-up action needs to keep the modal up.
 */
export function flashSuccessAndClose(
  successTitle: string,
  options: { subtitle?: string; delayMs?: number } = {}
): ReturnType<typeof setTimeout> {
  const modal = ensureModal()
  setSuccessState(modal, successTitle, options.subtitle)
  return setTimeout(() => {
    modal.classList.add('hidden')
    setLoadingState(modal, DEFAULT_LOADING_TITLE)
  }, options.delayMs ?? SUCCESS_DISPLAY_MS)
}

/** Force-close the modal immediately and reset to the loading skin. */
export function closeLoadingModal(): void {
  const modal = ensureModal()
  modal.classList.add('hidden')
  setLoadingState(modal, DEFAULT_LOADING_TITLE)
}

/**
 * Run an arbitrary async task while the modal is visible. Shows the
 * loading state during `task()`, then briefly flashes the success
 * state before closing. Errors close the modal and rethrow so the
 * caller can decide how to surface the failure.
 */
export async function runWithLoadingModal<T>(
  task: () => Promise<T>,
  options: { title: string; successTitle?: string; subtitle?: string; successSubtitle?: string }
): Promise<T> {
  openLoadingModal(options.title, options.subtitle)
  try {
    const result = await task()
    if (options.successTitle) {
      flashSuccessAndClose(options.successTitle, { subtitle: options.successSubtitle })
    } else {
      closeLoadingModal()
    }
    return result
  } catch (err) {
    closeLoadingModal()
    throw err
  }
}

export type DownloadPdfOptions = {
  /** Fallback filename when the server doesn't send Content-Disposition. */
  filenameHint?: string
  /** Heading shown inside the loading modal (e.g. "Generando reporte de personal"). */
  title?: string
  /** Heading flashed for ~1.4s after the bytes finish. Pass null to skip. */
  successTitle?: string | null
}

/**
 * Fetch a PDF from `url`, trigger a browser download with the file name
 * advertised by the server (or `options.filenameHint` if absent), and
 * keep a blocking modal visible for the entire round-trip.
 *
 * Errors surface as a native alert so the user knows the click had an
 * outcome — silent failures would leave them staring at nothing.
 */
export async function downloadPdfWithModal(
  url: string,
  options: DownloadPdfOptions = {}
): Promise<void> {
  const title = options.title ?? DEFAULT_LOADING_TITLE
  const successTitle =
    options.successTitle === null ? null : (options.successTitle ?? 'Descarga lista')
  openLoadingModal(title)
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(body || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') ?? ''
    const match = cd.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? options.filenameHint ?? 'reporte.pdf'

    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer revocation so the browser actually consumes the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)

    if (successTitle) {
      flashSuccessAndClose(successTitle)
    } else {
      closeLoadingModal()
    }
  } catch (err) {
    closeLoadingModal()
    console.error('PDF download error:', err)
    const message = err instanceof Error ? err.message : String(err)
    alert(`Error al generar el PDF: ${message}`)
  }
}

/**
 * Backwards-compatible alias — the previous payroll-only flow imported
 * this name. New code should call `downloadPdfWithModal` directly.
 */
export function downloadPayrollPdfWithModal(
  url: string,
  filenameHint = 'planilla.pdf'
): Promise<void> {
  return downloadPdfWithModal(url, {
    filenameHint,
    title: 'Generando planilla PDF',
    successTitle: 'Planilla generada exitosamente',
  })
}
