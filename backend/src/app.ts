import { backupRouter } from './modules/desktop-devices/backup.routes.js'
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
import { remoteDiskDavRouter, remoteDiskSettingsRouter } from './modules/desktop-devices/remote-disk.routes.js'
import { desktopDeviceRouter } from './modules/desktop-devices/desktop-device.routes.js'
import { googleCompleteLimit, googleStartLimit, refreshLimit, requestLimit, serviceLimit } from './middleware/request-limits.js'

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', env.TRUST_PROXY_HOPS === 0 ? false : env.TRUST_PROXY_HOPS)
app.use(requestLimit, serviceLimit)
app.use(['/auth/google/start', '/auth/google/connect'], googleStartLimit)
app.use(['/auth/google/complete', '/auth/google/callback', '/connected-accounts/google/callback'], googleCompleteLimit)
app.use('/auth/refresh', refreshLimit)

// WebDAV usa corpos binários e métodos próprios, inclusive OPTIONS.
app.use('/remote-disk/dav', remoteDiskDavRouter)
app.use(cors({ origin: new URL(env.FRONTEND_URL).origin, credentials: true }))
const parseJson = express.json({ limit: '1mb' })
app.use((req, res, next) => {
  // O corpo de trechos é binário mesmo quando o arquivo original é JSON.
  if (req.method === 'PUT' && /^\/uploads\/resumable\/chunk\/[^/]+\/?$/.test(req.path)) return next()
  if (req.method === 'PUT' && /^\/remote-disk\/devices\/[^/]+\/upload\/[^/]+\/?$/.test(req.path)) return next()
  return parseJson(req, res, next)
})
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Security-Policy', `default-src 'none'; base-uri 'none'; frame-ancestors ${new URL(env.FRONTEND_URL).origin}; sandbox`)
  next()
})
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
app.use('/desktop-devices', desktopDeviceRouter)
app.use('/remote-disk', remoteDiskSettingsRouter)
app.use('/backups', backupRouter)
app.use(errorMiddleware)
