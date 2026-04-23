/**
 * Central registry of every report that can be generated for a payroll.
 *
 * Adding a new report = append a new entry here, flip `status` to `'available'`
 * and implement the corresponding endpoint under
 * `apps/web/src/pages/api/reports/payroll/`.
 *
 * The UI (`/reports/payroll`) and the detail view (`/payroll/[id]`) both
 * consume this registry, so the dropdown stays consistent across the app.
 */

export type PayrollReportStatus = 'available' | 'coming-soon'

export type PayrollReportDefinition = {
  /** Stable identifier; used in URLs and as a React key. */
  id: string
  /** Human-readable label shown in the dropdown. */
  label: string
  /** Short helper text — appears as a subtitle / tooltip. */
  description: string
  /** Whether the report is implemented or still stubbed. */
  status: PayrollReportStatus
  /** Monospace short code ("PDF", "XLS", etc.) rendered as a leading chip. */
  code: string
  /** Builds the URL for this report given a payroll id. */
  href(payrollId: string): string
  /**
   * Some reports download a file (PDF, XLSX); others navigate to an in-app
   * preview. Used by the dropdown to decide whether to add `target="_blank"`.
   */
  opensInNewTab?: boolean
}

export const PAYROLL_REPORTS: readonly PayrollReportDefinition[] = [
  {
    id: 'pdf-landscape',
    label: 'Planilla PDF',
    description: 'Reporte consolidado en PDF (formato horizontal).',
    status: 'available',
    code: 'PDF',
    href: (id) => `/api/reports/payroll/${id}/pdf`,
    opensInNewTab: true,
  },
  {
    id: 'xlsx',
    label: 'Planilla en Excel',
    description: 'Exportación a .xlsx con resumen y detalle por empleado.',
    status: 'coming-soon',
    code: 'XLS',
    href: (id) => `/api/reports/payroll/${id}/xlsx`,
    opensInNewTab: false,
  },
  {
    id: 'summary',
    label: 'Resumen de Planilla',
    description: 'Totales agregados por departamento, concepto y tipo.',
    status: 'coming-soon',
    code: 'RES',
    href: (id) => `/api/reports/payroll/${id}/summary`,
    opensInNewTab: true,
  },
  {
    id: 'payslips',
    label: 'Comprobantes de pago',
    description: 'PDF individual por empleado con conceptos y firmas.',
    status: 'coming-soon',
    code: 'COM',
    href: (id) => `/api/reports/payroll/${id}/payslips`,
    opensInNewTab: true,
  },
  {
    id: 'payslips-email',
    label: 'Enviar comprobantes por correo',
    description: 'Genera y envía los comprobantes a cada empleado por email.',
    status: 'coming-soon',
    code: 'MAIL',
    href: (id) => `/api/reports/payroll/${id}/payslips-email`,
    opensInNewTab: false,
  },
  {
    id: 'anexo-09',
    label: 'Anexo 09',
    description: 'Reporte oficial para la CSS (Caja de Seguro Social).',
    status: 'coming-soon',
    code: 'A09',
    href: (id) => `/api/reports/payroll/${id}/anexo-09`,
    opensInNewTab: true,
  },
] as const

export function getReport(id: string): PayrollReportDefinition | undefined {
  return PAYROLL_REPORTS.find((r) => r.id === id)
}
