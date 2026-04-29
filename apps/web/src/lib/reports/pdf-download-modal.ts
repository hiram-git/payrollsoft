/**
 * Shared loading-modal helper for the on-demand "Planilla PDF" flow.
 *
 * The modal blocks the screen while the browser fetches the PDF bytes
 * from the server, so the user gets clear feedback that something is
 * happening (the on-demand strategy renders the report on every click,
 * which can take several seconds for large planillas).
 *
 * The modal is lazy-injected into the DOM on first use so it lives in
 * exactly one place regardless of which page imports the helper —
 * keeping the visuals consistent between `/payroll/[id]` and
 * `/reports/payroll`.
 */
const MODAL_ID = 'payroll-pdf-loading-modal'

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
      <svg class="w-10 h-10 animate-spin text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
      <p class="text-sm font-semibold text-gray-900">Generando planilla PDF</p>
      <p class="text-xs text-gray-500">Esto puede tardar unos segundos…</p>
    </div>
  `
  document.body.appendChild(modal)
  return modal
}

/**
 * Fetch a PDF from `url`, trigger a browser download with the file name
 * advertised by the server (or `filenameHint` if absent), and keep a
 * blocking modal visible for the entire round-trip.
 *
 * Errors surface as a native alert so the user knows the click had an
 * outcome — silent failures would leave them staring at nothing.
 */
export async function downloadPayrollPdfWithModal(
  url: string,
  filenameHint = 'planilla.pdf'
): Promise<void> {
  const modal = ensureModal()
  modal.classList.remove('hidden')
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(body || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') ?? ''
    const match = cd.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? filenameHint

    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer revocation so the browser actually consumes the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (err) {
    console.error('Payroll PDF download error:', err)
    const message = err instanceof Error ? err.message : String(err)
    alert(`Error al generar el PDF: ${message}`)
  } finally {
    modal.classList.add('hidden')
  }
}
