import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { PayrollPdf } from '../pdf/payroll-pdf'
import type { PayrollReportData } from './payroll-data'

/**
 * Render the landscape A4 payroll PDF to raw bytes. Centralising this lets
 * the generate endpoint and any future background job share a single code
 * path for producing the buffer that eventually lands on disk.
 */
export async function renderPayrollPdfBuffer(data: PayrollReportData): Promise<Uint8Array> {
  const element = React.createElement(PayrollPdf, {
    payroll: data.payroll,
    lines: data.lines,
    company: data.company,
  })
  // @react-pdf/renderer's `renderToBuffer` signature doesn't match React 19's
  // `FunctionComponentElement`; runtime is fine, the cast silences the
  // mismatch without disabling the rest of the file's type checking.
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  return new Uint8Array(buffer)
}
