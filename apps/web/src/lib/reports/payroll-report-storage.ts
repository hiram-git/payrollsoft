import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Root directory where generated payroll PDFs are persisted. Override with
 * `STORAGE_DIR` (absolute path) for production; the default is a stable
 * system-temp subdirectory so a fresh clone can generate reports without
 * extra setup.
 */
export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join('/tmp', 'payrollsoft-storage')

const DEFAULT_TENANT = 'demo'

/**
 * Build the absolute on-disk path for a payroll's report. Matches the layout
 * `{STORAGE_DIR}/{tenant}_storage/reports/payroll/{payrollId}/report.pdf`
 * recommended by the spec.
 */
export function payrollReportPath(payrollId: string, tenantSlug: string = DEFAULT_TENANT) {
  return path.join(
    STORAGE_DIR,
    `${tenantSlug}_storage`,
    'reports',
    'payroll',
    payrollId,
    'report.pdf'
  )
}

/**
 * Writes the PDF bytes to disk, creating parent directories as needed.
 * Returns the absolute path that was written — the caller hands this to the
 * API so the state row references the same file.
 */
export async function writePayrollReport(
  payrollId: string,
  pdf: Uint8Array,
  tenantSlug: string = DEFAULT_TENANT
): Promise<string> {
  const fullPath = payrollReportPath(payrollId, tenantSlug)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, pdf)
  return fullPath
}

export async function payrollReportExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath)
    return s.isFile()
  } catch {
    return false
  }
}
