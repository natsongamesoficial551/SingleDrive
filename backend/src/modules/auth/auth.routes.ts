import { Router } from 'express'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'
import { oauthRouter, googleCallback, completeGoogleLogin } from './oauth.service.js'
import { createSession, setRefreshCookie, clearRefreshCookie, readRefreshCookie } from './session.service.js'

import { discordLoginRouter } from '../discord/discord-login.routes.js'
import { enabledIdentity } from './verified-identity.js'
import { discordRouter } from '../discord/discord.routes.js'

export const authRouter = Router()

// Em produção o frontend acessa a API pelo proxy da mesma origem.
authRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const desktopRequest = req.header('X-SingleDrive-Desktop') === '1' &&
    ['/google/start', '/google/complete', '/refresh', '/logout'].includes(req.path) && !req.header('Origin')
  if (req.method !== 'GET' && !desktopRequest && req.header('Origin') !== new URL(env.FRONTEND_URL).origin)
    return res.status(403).json({ code: 'AUTH_ORIGIN_FORBIDDEN', message: 'Origem de autenticação inválida.' })
  return next()
})

authRouter.post(['/login', '/register'], (_req, res) => {
  return res.status(410).json({ code: 'GOOGLE_LOGIN_ONLY', message: 'Entre com Google ou Discord para acessar o SingleDrive.' })
})

authRouter.use('/discord/login', discordLoginRouter)
authRouter.use('/discord', discordRouter)
authRouter.use(oauthRouter)
authRouter.get('/google/callback', googleCallback)
authRouter.post('/google/complete', completeGoogleLogin(createSession))

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token = readRefreshCookie(req)
    if (!token) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Entre novamente.' })
    const session = await prisma.userSession.findFirst({ where: { refreshTokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'active', ...enabledIdentity } }, include: { user: true } })
    if (!session) { clearRefreshCookie(res); return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Entre novamente.' }) }
    const nextToken = randomToken()
    const rotated = await prisma.userSession.updateMany({ where: { id: session.id, refreshTokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } }, data: { refreshTokenHash: hashToken(nextToken) } })
    if (rotated.count !== 1) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Entre novamente.' })
    setRefreshCookie(res, nextToken)
    return res.json({ accessToken: signAccessToken({ sub: session.userId, sid: session.id }), user: { id: session.user.id, name: session.user.name, email: session.user.email } })
  } catch (error) { return next(error) }
})

authRouter.post('/logout', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await prisma.userSession.update({ where: { id: req.user!.sessionId }, data: { revokedAt: new Date() } })
    clearRefreshCookie(res)
    return res.json({ status: 'ok' })
  } catch (error) { return next(error) }
})

authRouter.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try { return res.json({ user: await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, status: true } }) }) }
  catch (error) { return next(error) }
})
