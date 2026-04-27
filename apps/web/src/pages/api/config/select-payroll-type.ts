import type { APIRoute } from 'astro'

export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData()
  const typeId = form.get('payrollTypeId')?.toString() ?? ''
  const returnTo = form.get('returnTo')?.toString() || '/'

  // Validate returnTo is a local path to prevent open-redirect
  const safePath = returnTo.startsWith('/') ? returnTo : '/'

  // The mandatory global filter has no "no selection" state — refusing an
  // empty `typeId` here keeps the cookie always pointing at a real type.
  // The AppLayout falls back to the first type when the cookie is missing,
  // so a stale or absent cookie self-heals on the next request.
  if (typeId) {
    cookies.set('payroll.activeTypeId', typeId, {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      httpOnly: false,
      sameSite: 'lax',
    })
  }

  return new Response(null, { status: 302, headers: { Location: safePath } })
}
