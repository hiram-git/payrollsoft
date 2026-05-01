/**
 * Lightweight design-system dialog helpers — drop-in replacements for
 * `window.confirm()` and `window.alert()` that match the rest of the
 * UI (rounded card, navy / emerald / red accents, Tailwind tokens).
 *
 * Lazy-injected on first use so a page only pays for the DOM once.
 * Returns Promises so calling code reads top-to-bottom:
 *
 *   if (!await confirmDialog({ ... })) return
 *   await alertDialog({ ... })
 */

const DIALOG_ID = 'pds-dialog'

type DialogKind = 'info' | 'success' | 'warning' | 'danger'

const KIND_TO_ICON: Record<DialogKind, string> = {
  info: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success:
    '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9.5"/></svg>',
  warning:
    '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger:
    '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
}

const KIND_TO_BG: Record<DialogKind, string> = {
  info: 'bg-blue-50',
  success: 'bg-emerald-50',
  warning: 'bg-amber-50',
  danger: 'bg-red-50',
}

const KIND_TO_PRIMARY_BTN: Record<DialogKind, string> = {
  info: 'bg-blue-600 hover:bg-blue-700',
  success: 'bg-emerald-600 hover:bg-emerald-700',
  warning: 'bg-amber-600 hover:bg-amber-700',
  danger: 'bg-red-600 hover:bg-red-700',
}

function ensureDialog(): HTMLElement {
  const existing = document.getElementById(DIALOG_ID)
  if (existing) return existing

  const root = document.createElement('div')
  root.id = DIALOG_ID
  root.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.innerHTML = `
    <div data-pds-backdrop class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <div data-pds-card class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <div data-pds-icon-wrap class="w-10 h-10 rounded-full flex items-center justify-center mb-4 bg-blue-50"></div>
      <h3 data-pds-title class="text-lg font-semibold text-gray-900 mb-1">Confirmar</h3>
      <p data-pds-message class="text-sm text-gray-600 leading-relaxed mb-5"></p>
      <div class="flex items-center justify-end gap-2">
        <button data-pds-cancel type="button" class="px-3.5 py-2 rounded-md border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors">Cancelar</button>
        <button data-pds-confirm type="button" class="px-3.5 py-2 rounded-md text-white text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700">Aceptar</button>
      </div>
    </div>
  `
  document.body.appendChild(root)
  return root
}

export type DialogOptions = {
  title: string
  message: string
  kind?: DialogKind
  confirmLabel?: string
  cancelLabel?: string
}

function paint(root: HTMLElement, opts: DialogOptions, mode: 'confirm' | 'alert') {
  const kind = opts.kind ?? (mode === 'alert' ? 'info' : 'warning')
  const titleEl = root.querySelector<HTMLElement>('[data-pds-title]')
  const msgEl = root.querySelector<HTMLElement>('[data-pds-message]')
  const iconWrap = root.querySelector<HTMLElement>('[data-pds-icon-wrap]')
  const confirmBtn = root.querySelector<HTMLButtonElement>('[data-pds-confirm]')
  const cancelBtn = root.querySelector<HTMLButtonElement>('[data-pds-cancel]')

  if (titleEl) titleEl.textContent = opts.title
  if (msgEl) msgEl.textContent = opts.message
  if (iconWrap) {
    iconWrap.className = `w-10 h-10 rounded-full flex items-center justify-center mb-4 ${KIND_TO_BG[kind]}`
    iconWrap.innerHTML = KIND_TO_ICON[kind]
  }
  if (confirmBtn) {
    confirmBtn.textContent = opts.confirmLabel ?? (mode === 'alert' ? 'Aceptar' : 'Continuar')
    confirmBtn.className = `px-3.5 py-2 rounded-md text-white text-sm font-medium transition-colors ${KIND_TO_PRIMARY_BTN[kind]}`
  }
  if (cancelBtn) {
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancelar'
    cancelBtn.classList.toggle('hidden', mode === 'alert')
  }
}

function open(root: HTMLElement) {
  root.classList.remove('hidden')
}
function close(root: HTMLElement) {
  root.classList.add('hidden')
}

/**
 * Two-button confirm dialog. Resolves `true` when the user accepts and
 * `false` on cancel / backdrop click / Escape. Returns the same Promise
 * shape as `window.confirm` so callers can `if (!await ...) return`.
 */
export function confirmDialog(opts: DialogOptions): Promise<boolean> {
  const root = ensureDialog()
  paint(root, opts, 'confirm')

  return new Promise<boolean>((resolve) => {
    const confirmBtn = root.querySelector<HTMLButtonElement>('[data-pds-confirm]')
    const cancelBtn = root.querySelector<HTMLButtonElement>('[data-pds-cancel]')
    const backdrop = root.querySelector<HTMLElement>('[data-pds-backdrop]')

    function cleanup(answer: boolean) {
      confirmBtn?.removeEventListener('click', onConfirm)
      cancelBtn?.removeEventListener('click', onCancel)
      backdrop?.removeEventListener('click', onCancel)
      document.removeEventListener('keydown', onKey)
      close(root)
      resolve(answer)
    }
    function onConfirm() {
      cleanup(true)
    }
    function onCancel() {
      cleanup(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cleanup(false)
      if (e.key === 'Enter') cleanup(true)
    }

    confirmBtn?.addEventListener('click', onConfirm)
    cancelBtn?.addEventListener('click', onCancel)
    backdrop?.addEventListener('click', onCancel)
    document.addEventListener('keydown', onKey)
    open(root)
    confirmBtn?.focus()
  })
}

/**
 * Single-button alert dialog. Resolves once the user dismisses it.
 * Use `kind: 'danger'` for hard errors, `'warning'` for soft errors,
 * `'success'` for positive confirmations and `'info'` for neutral
 * notices. Defaults to `'info'`.
 */
export function alertDialog(opts: DialogOptions): Promise<void> {
  const root = ensureDialog()
  paint(root, opts, 'alert')

  return new Promise<void>((resolve) => {
    const confirmBtn = root.querySelector<HTMLButtonElement>('[data-pds-confirm]')
    const backdrop = root.querySelector<HTMLElement>('[data-pds-backdrop]')

    function cleanup() {
      confirmBtn?.removeEventListener('click', onClose)
      backdrop?.removeEventListener('click', onClose)
      document.removeEventListener('keydown', onKey)
      close(root)
      resolve()
    }
    function onClose() {
      cleanup()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') cleanup()
    }

    confirmBtn?.addEventListener('click', onClose)
    backdrop?.addEventListener('click', onClose)
    document.addEventListener('keydown', onKey)
    open(root)
    confirmBtn?.focus()
  })
}
