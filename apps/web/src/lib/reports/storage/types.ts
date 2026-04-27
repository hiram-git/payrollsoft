/**
 * Driver-agnostic interface for persisting report PDFs. Implementations
 * include R2 (Cloudflare, S3-compatible) today and can grow to S3, GCS,
 * or local-disk variants without touching callers.
 *
 * Keys are tenant-prefixed (e.g. `reports/payroll/{tenant}/{payrollId}/report.pdf`)
 * so a single bucket can host many tenants safely.
 */
export type ReportStorageObject = {
  key: string
  bytes: Uint8Array
  contentType?: string
}

export interface ReportStorage {
  /** Upload (overwrite) the object at `key`. Returns the canonical key
   *  the caller should record in `payroll_reports.pdf_path`. */
  put(input: ReportStorageObject): Promise<string>

  /** Fetch the bytes for `key`, or `null` if the object is missing. */
  get(key: string): Promise<Uint8Array | null>

  /** Tag identifying the driver (used in logs / errors). */
  readonly driver: string
}

/**
 * Build the canonical object key for a given payroll. Centralised so
 * generate / download can never disagree on shape.
 */
export function payrollReportKey(payrollId: string, tenantSlug: string): string {
  return `reports/payroll/${tenantSlug}/${payrollId}/report.pdf`
}
