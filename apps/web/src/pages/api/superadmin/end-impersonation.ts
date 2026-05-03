import type { APIRoute } from 'astro'

/**
 * Restore the super-admin session that was stashed in `sa_session` when
 * the impersonation flow started. Called from the AppLayout banner.
 *
 * If the sa_session cookie is missing (e.g. expired), we just clear
 * everything and bounce to the super-admin login.
 */
export const POST: APIRoute = ({ cookies, redirect }) => {
  const stashed = cookies.get('sa_session')?.value
  cookies.delete('sa_session', { path: '/' })

  if (!stashed) {
    cookies.delete('auth', { path: '/' })
    return redirect('/superadmin/login')
  }

  cookies.set('auth', stashed, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
  })

  return redirect('/superadmin')
}
