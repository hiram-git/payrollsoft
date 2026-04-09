import type { APIRoute } from 'astro'

export const POST: APIRoute = ({ cookies, redirect }) => {
  cookies.delete('auth', { path: '/' })
  return redirect('/login')
}
