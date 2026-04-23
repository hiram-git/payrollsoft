import type { APIRoute } from 'astro'

export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData()
  const typeId = form.get('payrollTypeId')?.toString() ?? ''
  const returnTo = form.get('returnTo')?.toString() || '/'

  // Validate returnTo is a local path to prevent open-redirect
  const safePath = returnTo.startsWith('/') ? returnTo : '/'

  if (typeId) {
    cookies.set('payroll.activeTypeId', typeId, {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      httpOnly: false,
      sameSite: 'lax',
    })
  } else {
    cookies.delete('payroll.activeTypeId', { path: '/' })
  }

  return new Response(null, { status: 302, headers: { Location: safePath } })
}
