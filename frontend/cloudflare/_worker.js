// Pages Advanced Mode: mantém /api e o cookie HttpOnly na origem do frontend.
const apiOrigin = 'https://singledrive.onrender.com'
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; connect-src 'self' https://www.google.com/recaptcha/; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const upstream = new URL(apiOrigin)
      upstream.pathname = url.pathname.slice(4)
      upstream.search = url.search
      const headers = new Headers(request.headers)
      headers.delete('host')
      // Não encaminhar cabeçalhos de proxy fornecidos pelo chamador.
      for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) headers.delete(name)
      try {
        const response = await fetch(upstream, {
          method: request.method, headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'manual',
        })
        const result = new Response(response.body, response)
        result.headers.set('Cache-Control', 'private, no-store')
        return result
      } catch {
        return Response.json({ code: 'API_UNAVAILABLE', message: 'Servidor temporariamente indisponível.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
      }
    }
    let asset = await env.ASSETS.fetch(request)
    if (asset.status === 404 && ['GET', 'HEAD'].includes(request.method) && request.headers.get('Accept')?.includes('text/html')) {
      asset = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request))
    }
    const result = new Response(asset.body, asset)
    for (const [name, value] of Object.entries(securityHeaders)) result.headers.set(name, value)
    return result
  },
}
