import { r2Storage } from './r2-storage'
import type { ReportStorage } from './types'

export type PayrollReportMode = 'on_demand' | 'file_storage'

/**
 * Resolve the storage driver for a tenant based on its `payrollReportMode`.
 *
 *   on_demand    → null (caller should render the PDF live)
 *   file_storage → an R2-backed driver; throws synchronously on first use
 *                  if R2 env vars are missing, so the operator gets a
 *                  clear error instead of silent fallback.
 *
 * The factory shape is intentionally pluggable: adding a `local` or
 * `s3` driver later means a new branch + a new module — no caller change.
 */
export function getReportStorage(
  mode: PayrollReportMode | string | null | undefined
): ReportStorage | null {
  if (mode === 'file_storage') return r2Storage
  return null
}

export { payrollReportKey } from './types'
export type { ReportStorage, ReportStorageObject } from './types'
