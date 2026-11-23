import { createHash, createHmac } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { discordLinkLimit } from '../../middleware/request-limits.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { createSession, setRefreshCookie } from '../auth/session.service.js'
import { registerDiscordProfile } from '../auth/account-capacity.js'
import { discordAuthorizationUrl, discordOAuthSettings, discordProfile } from './discord-oauth.js'

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
  return res.json({ state, url: discordAuthorizationUrl(config, state, challenge, 'identify email') })
})

discordLoginRouter.post('/complete', async (req, res) => {
  const config = discordOAuthSettings()
  if (!config) return res.status(503).json({ message: 'A entrada pelo Discord está indisponível no momento.' })
  const parsed = loginInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Autorização inválida. Entre novamente.' })
  const { state, code } = parsed.data
  const secret = loginSecret(req, res, state)
  if (!secret) return res.status(400).json({ message: 'A autorização expirou ou foi iniciada em outro navegador.' })

  let profile: Awaited<ReturnType<typeof discordProfile>>
  try { profile = await discordProfile(config, code, verifier(secret, state)) }
  catch { return res.status(502).json({ message: 'Não foi possível confirmar sua conta no Discord. Tente novamente.' }) }

  const link = await prisma.discordLink.findUnique({
    where: { discordUserId: profile.id }, include: { user: true },
  })
  if (link && !link.loginEnabledAt) {
    return res.status(409).json({ message: 'Este Discord já está associado a um perfil. Entre pelo método original e habilite o Discord em Configurações → Login com Discord.' })
  }
  let user = link?.user
  if (!user) {
    const email = z.string().email().max(191).safeParse(profile.email?.trim().toLowerCase())
    if (!profile.verified || !email.success) {
      return res.status(403).json({ message: 'Verifique seu e-mail nas configurações do Discord antes de criar o perfil SingleDrive.' })
    }
    const name = (profile.global_name?.trim() || profile.username?.trim() || email.data).slice(0, 191)
    user = await registerDiscordProfile({ discordUserId: profile.id, email: email.data, name })
  }
  if (user.status !== 'active' || !user.emailVerifiedAt) {
    return res.status(403).json({ message: 'A conta exige revisão de segurança.' })
  }
  const session = await createSession(user.id, req)
  setRefreshCookie(res, session.refreshToken)
  return res.json({ accessToken: session.accessToken, user: { id: user.id, name: user.name, email: user.email } })
})
