import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { PersonnelPdf } from '../pdf/personnel-pdf'
import type { PersonnelReportData } from './personnel-data'

/**
 * Render the landscape A4 personnel PDF to raw bytes. Mirrors the
 * payroll renderer so future background-job pipelines can share a
 * single code path for either report.
 */
export async function renderPersonnelPdfBuffer(data: PersonnelReportData): Promise<Uint8Array> {
  const element = React.createElement(PersonnelPdf, {
    employees: data.employees,
    company: data.company,
    payrollTypeName: data.payrollTypeName,
    generatedBy: data.generatedBy ?? null,
  })
  // @react-pdf/renderer's `renderToBuffer` signature doesn't match
  // React 19's `FunctionComponentElement`; runtime is fine.
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  return new Uint8Array(buffer)
}
