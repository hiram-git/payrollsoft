import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { PayrollPdf } from '../pdf/payroll-pdf'
import type { PayrollReportData } from './payroll-data'
import { payrollFileSlug } from './payroll-data'

/**
 * Renders the landscape payroll PDF and wraps it in an HTTP Response with the
 * proper download headers. Keeping this separate from the Astro route means
 * the same renderer can be reused by the `/reports/payroll` page, the payroll
 * detail page and (eventually) a background job that mails the PDF.
 */
export async function renderPayrollPdfResponse(data: PayrollReportData): Promise<Response> {
  const buffer = await renderToBuffer(
    React.createElement(PayrollPdf, { payroll: data.payroll, lines: data.lines })
  )

  const filename = `planilla-${payrollFileSlug(data.payroll.name)}.pdf`

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
