import { localStorageDriver } from './local-storage'
import { r2Storage } from './r2-storage'
import type { ReportStorage } from './types'

export type PayrollReportMode = 'on_demand' | 'file_storage' | 'local_storage'

/**
 * Resolve the storage driver for a tenant based on its `payrollReportMode`.
 *
 *   on_demand     → null (caller should render the PDF live)
 *   file_storage  → R2 / S3-compatible cloud bucket. Throws on first use
 *                   if R2 env vars are missing.
 *   local_storage → disk under `STORAGE_DIR`. Suitable para instalaciones
 *                   on-prem / dev sin cuenta de almacenamiento remoto.
 *
 * El factory expone una interfaz pluggable: agregar un driver nuevo
 * (S3 nativo, GCS, Azure) significa una rama más sin tocar callers.
 */
export function getReportStorage(
  mode: PayrollReportMode | string | null | undefined
): ReportStorage | null {
  if (mode === 'file_storage') return r2Storage
  if (mode === 'local_storage') return localStorageDriver
  return null
}

export const REPORT_STORAGE_MODES: readonly PayrollReportMode[] = [
  'on_demand',
  'file_storage',
  'local_storage',
] as const

/**
 * `true` si el modo persiste el PDF entre solicitudes — útil para que la
 * UI decida si mostrar "Descargar PDF" (el archivo ya existe) o
 * "Generar PDF" (siempre se genera al vuelo).
 */
export function isPersistentMode(mode: string | null | undefined): boolean {
  return mode === 'file_storage' || mode === 'local_storage'
}

export { payrollReportKey } from './types'
export type { ReportStorage, ReportStorageObject } from './types'
