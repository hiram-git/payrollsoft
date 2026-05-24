import type { APIRoute } from 'astro'

export const POST: APIRoute = ({ cookies }) => {
  cookies.delete('portal_auth', { path: '/' })
  return Response.json({ success: true })
}
