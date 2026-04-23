import type { APIRoute } from 'astro'

/**
 * Legacy shortcut that used to render + return the PDF on every click. Now
 * that the report lives on disk and is keyed by a state row, this route
 * forwards to the download endpoint so existing bookmarks and links keep
 * working.
 */
export const GET: APIRoute = ({ params, redirect }) => {
  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })
  return redirect(`/api/reports/payroll/${id}/download`, 307)
}
