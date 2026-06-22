/**
 * PDF preview modal — fetches a PDF as a blob and displays it in an
 * <iframe> inside a fullscreen modal. Designed for short government
 * reports (≤3 pages) where the operator wants to review before
 * printing / saving. Also offers a direct "Descargar" button.
 *
 * Lazy-injected on first use (same pattern as pdf-download-modal).
 */
import { alertDialog } from '../ui/dialog'
import { closeLoadingModal, openLoadingModal } from './pdf-download-modal'

const PREVIEW_ID = 'pdf-preview-modal'

/**
 * Module-level lock: once a preview is in flight, additional calls
 * short-circuit. Prevents click-spam from spawning parallel fetches
 * before the blocking modal has had time to paint.
 */
let previewInFlight = false

function ensurePreviewModal(): HTMLElement {
  const existing = document.getElementById(PREVIEW_ID)
  if (existing) return existing

  const modal = document.createElement('div')
  modal.id = PREVIEW_ID
  modal.className = 'hidden fixed inset-0 z-50 flex flex-col'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.innerHTML = `
    <div data-preview-backdrop class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
    <div class="relative flex flex-col flex-1 m-4 md:m-8 bg-white rounded-2xl shadow-2xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
        <h3 data-preview-title class="text-sm font-semibold text-gray-900">Vista previa</h3>
        <div class="flex items-center gap-2">
          <a data-preview-download href="#" download class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Descargar
          </a>
          <button data-preview-close type="button" class="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Cerrar">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="flex-1 relative bg-gray-100">
        <iframe data-preview-frame class="w-full h-full border-0" title="PDF Preview"></iframe>
      </div>
    </div>
  `
  document.body.appendChild(modal)

  const close = modal.querySelector<HTMLButtonElement>('[data-preview-close]')
  const backdrop = modal.querySelector<HTMLElement>('[data-preview-backdrop]')
  function hide() {
    modal.classList.add('hidden')
    const frame = modal.querySelector<HTMLIFrameElement>('[data-preview-frame]')
    if (frame) frame.src = 'about:blank'
    const dl = modal.querySelector<HTMLAnchorElement>('[data-preview-download]')
    if (dl?.href?.startsWith('blob:')) URL.revokeObjectURL(dl.href)
  }
  close?.addEventListener('click', hide)
  backdrop?.addEventListener('click', hide)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) hide()
  })

  return modal
}

export type PreviewPdfOptions = {
  title?: string
  filenameHint?: string
}

/**
 * Fetch a PDF from `url`, show a loading modal, then display it in a
 * fullscreen iframe overlay. The user can review, print (via browser),
 * or click "Descargar" to save.
 */
export async function previewPdfInModal(
  url: string,
  options: PreviewPdfOptions = {}
): Promise<void> {
  if (previewInFlight) return
  previewInFlight = true
  // Open the loading modal SYNCHRONOUSLY before any await so the
  // backdrop paints immediately and eats any further clicks while
  // the fetch is in progress.
  openLoadingModal(options.title ?? 'Cargando reporte')

  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(body || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)

    closeLoadingModal()

    const modal = ensurePreviewModal()
    const titleEl = modal.querySelector<HTMLElement>('[data-preview-title]')
    const frame = modal.querySelector<HTMLIFrameElement>('[data-preview-frame]')
    const dl = modal.querySelector<HTMLAnchorElement>('[data-preview-download]')

    if (titleEl) titleEl.textContent = options.title ?? 'Vista previa'
    if (frame) frame.src = objectUrl
    if (dl) {
      dl.href = objectUrl
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      dl.download = match?.[1] ?? options.filenameHint ?? 'reporte.pdf'
    }

    modal.classList.remove('hidden')
  } catch (err) {
    closeLoadingModal()
    const message = err instanceof Error ? err.message : String(err)
    await alertDialog({
      title: 'Error al cargar el reporte',
      message,
      kind: 'danger',
    })
  } finally {
    previewInFlight = false
  }
}
