import { createHash, createHmac } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { discordLinkLimit } from '../../middleware/request-limits.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { createSession, setRefreshCookie } from '../auth/session.service.js'
import { discordAuthorizationUrl, discordIdentity, discordOAuthSettings } from './discord-oauth.js'

const secure = new URL(env.FRONTEND_URL).protocol === 'https:'
const cookie = secure ? '__Host-sd_discord_login' : 'sd_discord_login_dev'
const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' }
const statePattern = /^[A-Za-z0-9_-]{43}$/
const loginInput = z.object({ code: z.string().min(1).max(512), state: z.string().regex(statePattern) })
const verifier = (secret: string, state: string) =>
  createHmac('sha256', env.TOKEN_ENCRYPTION_KEY).update('discord-login:' + secret + ':' + state).digest('base64url')

function loginSecret(req: Request, res: Response, state: string) {
  const values = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(cookie + '='))
  res.clearCookie(cookie, cookieOptions)
  if (values.length !== 1) return null
  const [stateHash, secret, ...rest] = values[0]!.slice(cookie.length + 1).split('.')
  return rest.length === 0 && stateHash === hashToken(state) && secret && statePattern.test(secret) ? secret : null
}

export const discordLoginRouter = Router()
discordLoginRouter.use(discordLinkLimit)

discordLoginRouter.post('/start', (_req, res) => {
  const config = discordOAuthSettings()
  if (!config) return res.status(503).json({ message: 'A entrada pelo Discord está indisponível no momento.' })
  const state = randomToken()
  const secret = randomToken()
  const challenge = createHash('sha256').update(verifier(secret, state)).digest('base64url')
  res.cookie(cookie, hashToken(state) + '.' + secret, { ...cookieOptions, maxAge: 10 * 60_000 })
  return res.json({ state, url: discordAuthorizationUrl(config, state, challenge) })
})

discordLoginRouter.post('/complete', async (req, res) => {
  const config = discordOAuthSettings()
  if (!config) return res.status(503).json({ message: 'A entrada pelo Discord está indisponível no momento.' })
  const parsed = loginInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Autorização inválida. Entre novamente.' })
  const { state, code } = parsed.data
  const secret = loginSecret(req, res, state)
  if (!secret) return res.status(400).json({ message: 'A autorização expirou ou foi iniciada em outro navegador.' })

  let discordUserId: string
  try { discordUserId = await discordIdentity(config, code, verifier(secret, state)) }
  catch { return res.status(502).json({ message: 'Não foi possível confirmar sua conta no Discord. Tente novamente.' }) }

  const link = await prisma.discordLink.findFirst({
    where: { discordUserId, verifiedAt: { not: null }, user: {
      status: 'active', googleSubject: { not: null }, emailVerifiedAt: { not: null },
    } },
    select: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!link) return res.status(403).json({ message: 'Entre com Google e vincule sua conta Discord em Configurações antes de usar esse acesso.' })
  const session = await createSession(link.user.id, req)
  setRefreshCookie(res, session.refreshToken)
  return res.json({ accessToken: session.accessToken, user: link.user })
})
