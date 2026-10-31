import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'
import { oauthRouter, googleCallback, completeGoogleLogin } from './oauth.service.js'
import { createSession, setRefreshCookie, clearRefreshCookie, readRefreshCookie } from './session.service.js'

export const authRouter = Router()
const emailSchema = z.string().trim().toLowerCase().email().max(191)
const registerSchema = z.object({ name: z.string().trim().min(2).max(191), email: emailSchema, password: z.string().min(12).max(128), captchaToken: z.string().max(4096).optional() })
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) })

// Em produção o frontend acessa a API pelo proxy da mesma origem.
authRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.header('Origin') !== new URL(env.FRONTEND_URL).origin)
    return res.status(403).json({ code: 'AUTH_ORIGIN_FORBIDDEN', message: 'Origem de autenticação inválida.' })
  return next()
})

authRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body)
    if (env.RECAPTCHA_SECRET_KEY) {
      if (!body.captchaToken) return res.status(400).json({ code: 'CAPTCHA_FAILED', message: 'Verifique o captcha.' })
      const result = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: body.captchaToken }) })
      if (!(await result.json() as { success?: boolean }).success) return res.status(400).json({ code: 'CAPTCHA_FAILED', message: 'Verifique o captcha.' })
    }
    if (await prisma.user.findUnique({ where: { email: body.email } })) return res.status(409).json({ code: 'AUTH_REGISTER_UNAVAILABLE', message: 'Não foi possível criar a conta com estes dados.' })
    const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password) } })
    const { accessToken, refreshToken } = await createSession(user.id, req)
    setRefreshCookie(res, refreshToken)
    return res.status(201).json({ accessToken, user: { id: user.id, name: user.name, email: user.email } })
  } catch (error) { return next(error) }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user || user.status !== 'active' || user.googleSubject || !(await verifyPassword(user.passwordHash, body.password)))
      return res.status(401).json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' })
    const { accessToken, refreshToken } = await createSession(user.id, req)
    setRefreshCookie(res, refreshToken)
    return res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email } })
  } catch (error) { return next(error) }
})

authRouter.use(oauthRouter)
authRouter.get('/google/callback', googleCallback)
authRouter.post('/google/complete', completeGoogleLogin(createSession))

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token = readRefreshCookie(req)
    if (!token) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Entre novamente.' })
    const session = await prisma.userSession.findFirst({ where: { refreshTokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'active' } }, include: { user: true } })
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
