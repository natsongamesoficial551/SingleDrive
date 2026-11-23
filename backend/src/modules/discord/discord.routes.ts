import { createHash, createHmac } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { discordLinkLimit } from '../../middleware/request-limits.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { discordBotRequest, discordRequest, discordRoleSettings, snowflake, type DiscordMember } from './discord-api.js'

const settings = () => {
  const roles = discordRoleSettings()
  const { DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: clientSecret } = env
  return roles && clientId && clientSecret ? { ...roles, clientId, clientSecret } : null
}

const callback = () => new URL('/discord/callback', env.FRONTEND_URL).href
const verifierFor = (state: string, sessionId: string) =>
  createHmac('sha256', env.TOKEN_ENCRYPTION_KEY).update('discord-pkce:' + sessionId + ':' + state).digest('base64url')
const codeInput = z.object({ code: z.string().min(1).max(512), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })

export const discordRouter = Router()
discordRouter.use(requireAuth)

discordRouter.get('/', async (req: AuthRequest, res) => {
  const link = await prisma.discordLink.findUnique({ where: { userId: req.user!.id }, select: { verifiedAt: true } })
  res.json({ configured: !!settings(), linked: !!link?.verifiedAt, guildId: env.DISCORD_GUILD_ID ?? null })
})

discordRouter.post('/start', discordLinkLimit, async (req: AuthRequest, res) => {
  const config = settings()
  if (!config) return res.status(503).json({ message: 'A verificação pelo Discord está indisponível.' })
  const { id, sessionId } = req.user!
  const user = await prisma.user.findUnique({ where: { id }, select: { emailVerifiedAt: true } })
  if (!user?.emailVerifiedAt) return res.status(403).json({ message: 'Entre novamente com uma conta Google verificada.' })
  const state = randomToken()
  await prisma.discordLinkState.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  await prisma.discordLinkState.create({ data: {
    stateHash: hashToken(state), sessionId, expiresAt: new Date(Date.now() + 10 * 60_000),
  } })
  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, scope: 'identify', redirect_uri: callback(), state,
    code_challenge: createHash('sha256').update(verifierFor(state, sessionId)).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  return res.json({ url: url.href })
})

discordRouter.post('/complete', discordLinkLimit, async (req: AuthRequest, res) => {
  const config = settings()
  if (!config) return res.status(503).json({ message: 'A verificação pelo Discord está indisponível.' })
  const parsed = codeInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Autorização inválida. Inicie a vinculação novamente.' })
  const { state, code } = parsed.data
  const { id, sessionId } = req.user!
  const consumed = await prisma.discordLinkState.deleteMany({
    where: { stateHash: hashToken(state), sessionId, expiresAt: { gt: new Date() } },
  })
  if (consumed.count !== 1) return res.status(400).json({ message: 'A autorização expirou ou pertence a outra sessão. Inicie novamente.' })

  let discordUserId: string
  try {
    const tokenResponse = await discordRequest('/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: callback(), code, code_verifier: verifierFor(state, sessionId),
      }),
    })
    if (!tokenResponse.ok) {
      return res.status(502).json({ message: 'O Discord não confirmou a autorização. Inicie novamente.' })
    }
    const result = await tokenResponse.json() as { access_token?: string }
    if (!result.access_token) throw new Error('Missing Discord access token')
    const identity = await discordRequest('/users/@me', { headers: { Authorization: 'Bearer ' + result.access_token } })
    if (!identity.ok) throw new Error('Discord identity failed')
    const profile = await identity.json() as { id?: string; bot?: boolean }
    if (!profile.id || !snowflake.test(profile.id) || profile.bot) throw new Error('Invalid Discord identity')
    discordUserId = profile.id
    const member = await discordBotRequest(config.token, `/guilds/${config.guildId}/members/${discordUserId}`)
    if (member.status === 404) return res.status(409).json({ message: 'Entre no servidor SingleDrive no Discord e tente novamente.' })
    if (!member.ok) throw new Error('Discord membership check failed')
    if ((await member.json() as DiscordMember).pending) {
      return res.status(409).json({ message: 'Conclua a entrada no servidor SingleDrive e tente novamente.' })
    }
  } catch {
    return res.status(502).json({ message: 'Não foi possível validar sua conta no Discord. Tente novamente.' })
  }

  const session = await prisma.userSession.findFirst({
    where: { id: sessionId, userId: id, revokedAt: null, expiresAt: { gt: new Date() }, user: {
      status: 'active', googleSubject: { not: null }, emailVerifiedAt: { not: null },
    } }, select: { id: true },
  })
  if (!session) return res.status(401).json({ message: 'Sua sessão do SingleDrive expirou.' })
  // Reserve the unique pair before granting the role. Reauthorizing the same pair retries a failed grant.
  await prisma.discordLink.createMany({ data: [{ userId: id, discordUserId }], skipDuplicates: true })
  const link = await prisma.discordLink.findUnique({ where: { userId: id } })
  if (link?.discordUserId !== discordUserId) {
    return res.status(409).json({ message: 'Uma dessas contas já está vinculada a outra conta.' })
  }
  try {
    const rolePath = `/guilds/${config.guildId}/members/${discordUserId}/roles/`
    for (const role of [config.memberRoleId, config.followingRoleId]) {
      if (!(await discordBotRequest(config.token, rolePath + role, 'PUT')).ok) throw new Error('Discord role grant failed')
    }
    await prisma.discordLink.update({ where: { userId: id }, data: { verifiedAt: new Date() } })
  } catch {
    return res.status(502).json({ message: 'Não foi possível aplicar o cargo no Discord. Tente vincular novamente.' })
  }
  return res.json({ linked: true })
})
