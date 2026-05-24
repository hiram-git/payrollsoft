import { defineMiddleware } from 'astro:middleware'

export const onRequest = defineMiddleware(({ request, rewrite }, next) => {
  const host = request.headers.get('host') ?? ''
  const subdomain = host.split('.')[0]?.toLowerCase()

  if (subdomain !== 'portal') return next()

  const url = new URL(request.url)
  const path = url.pathname

  if (path.startsWith('/portal') || path.startsWith('/api/portal')) return next()

  if (path === '/' || path === '') {
    return rewrite(new Request(new URL('/portal/', request.url), request))
  }

  if (path === '/login') {
    return rewrite(new Request(new URL('/portal/login', request.url), request))
  }

  if (path === '/forgot-password') {
    return rewrite(new Request(new URL('/portal/forgot-password', request.url), request))
  }

  if (path.startsWith('/reset-password')) {
    return rewrite(new Request(new URL(`/portal${path}${url.search}`, request.url), request))
  }

  if (
    path.startsWith('/requests') ||
    path.startsWith('/approvals') ||
    path.startsWith('/attendance')
  ) {
    return rewrite(new Request(new URL(`/portal${path}${url.search}`, request.url), request))
  }

  if (path.startsWith('/api/')) {
    return rewrite(
      new Request(new URL(`/api/portal${path.slice(4)}${url.search}`, request.url), request)
    )
  }

  return next()
})
