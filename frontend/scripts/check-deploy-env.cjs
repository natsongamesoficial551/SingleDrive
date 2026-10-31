const apiUrl = process.env.VITE_API_URL

try {
  const url = new URL(apiUrl)
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error()
} catch {
  console.error('Defina VITE_API_URL com a URL HTTPS publica do backend antes de publicar no Netlify.')
  process.exit(1)
}
