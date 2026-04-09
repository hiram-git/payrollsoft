// PDF helpers — full implementation in Phase 4
// Will use @react-pdf/renderer or puppeteer

export type PdfOptions = {
  title: string
  company: string
  logoUrl?: string
}

// Stub
export async function generatePdf(_options: PdfOptions, _data: unknown): Promise<Buffer> {
  throw new Error('PDF generation not yet implemented — coming in Phase 4')
}
