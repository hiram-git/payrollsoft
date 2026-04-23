import type { APIRoute } from 'astro'

/**
 * Legacy route. Forwards to the canonical reports download endpoint so
 * bookmarks from older sessions still work.
 */
export const GET: APIRoute = ({ params, redirect }) => {
  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })
  return redirect(`/api/reports/payroll/${id}/download`, 307)
}
