import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorMiddleware } from './middleware/error.middleware.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { providerConfigRouter } from './modules/provider-configs/provider-config.routes.js'
import { connectedAccountRouter } from './modules/connected-accounts/connected-account.routes.js'
import { storageRouter } from './modules/storage/storage.routes.js'
import { uploadRouter } from './modules/uploads/upload.routes.js'
import { fileRouter } from './modules/files/file.routes.js'
import { folderRouter } from './modules/folders/folder.routes.js'
import { publicRouter } from './modules/public/public.routes.js'
import { inviteRouter } from './modules/invites/invite.routes.js'
import { apiKeyRouter } from './modules/api-keys/api-key.routes.js'
import { publicApiRouter } from './modules/public-api/public-api.routes.js'
import { auditLogRouter } from './modules/audit-logs/audit-log.routes.js'
import { systemRouter } from './modules/system/system.routes.js'
import { rateLimit } from 'express-rate-limit'
import { AuthRateLimitStore } from './middleware/auth-rate-limit.js'

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', env.TRUST_PROXY_HOPS === 0 ? false : env.TRUST_PROXY_HOPS)

app.use(cors({ origin: new URL(env.FRONTEND_URL).origin, credentials: true }))
const parseJson = express.json({ limit: '1mb' })
app.use((req, res, next) => {
  // O corpo de trechos é binário mesmo quando o arquivo original é JSON.
  if (req.method === 'PUT' && /^\/uploads\/resumable\/chunk\/[^/]+\/?$/.test(req.path)) return next()
  return parseJson(req, res, next)
})
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Security-Policy', `default-src 'none'; base-uri 'none'; frame-ancestors ${new URL(env.FRONTEND_URL).origin}; sandbox`)
  next()
})
// Consultas /me e rotação de sessão não são tentativas de login.
// Manter o orçamento de entradas OAuth separado das tentativas de senha.
app.use(['/auth/google/start', '/auth/google/complete'], rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  store: new AuthRateLimitStore('oauth-ip-v2'),
  message: { code: 'AUTH_RATE_LIMITED', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' } }))
app.use(['/auth/login', '/auth/register'], rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  store: new AuthRateLimitStore('password-ip-v2'), skipSuccessfulRequests: true,
  message: { code: 'AUTH_RATE_LIMITED', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' } }))
app.use(['/auth/login', '/auth/register'], rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  store: new AuthRateLimitStore('account'), keyGenerator: req => String(req.body?.email ?? '').trim().toLowerCase().slice(0, 191),
  skipSuccessfulRequests: true,
  message: { code: 'AUTH_RATE_LIMITED', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' } }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api', publicApiRouter)
app.use('/public', publicRouter)
app.use('/auth', authRouter)
app.use('/api-keys', apiKeyRouter)
app.use('/provider-configs', providerConfigRouter)
app.use('/connected-accounts', connectedAccountRouter)
app.use('/storage', storageRouter)
app.use('/uploads', uploadRouter)
app.use('/files', fileRouter)
app.use('/folders', folderRouter)
app.use('/invites', inviteRouter)
app.use('/audit-logs', auditLogRouter)
app.use('/system', systemRouter)
app.use(errorMiddleware)
