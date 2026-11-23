import { createHash, createHmac } from 'node:crypto'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { discordLinkLimit } from '../../middleware/request-limits.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { enabledIdentity } from '../auth/verified-identity.js'
import { discordBotRequest, discordRoleSettings, type DiscordMember } from './discord-api.js'
import { discordAuthorizationUrl, discordIdentity, discordOAuthSettings } from './discord-oauth.js'

type Purpose = 'community' | 'access'
type OAuthConfig = NonNullable<ReturnType<typeof discordOAuthSettings>>
type BrowserSession = NonNullable<AuthRequest['user']>
const stateHash = (state: string, purpose: Purpose) => hashToken(purpose === 'community' ? state : 'discord-access:' + state)
const verifierFor = (state: string, sessionId: string) =>
  createHmac('sha256', env.TOKEN_ENCRYPTION_KEY).update('discord-pkce:' + sessionId + ':' + state).digest('base64url')
const codeInput = z.object({ code: z.string().min(1).max(512), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })

export const discordRouter = Router()
discordRouter.use(requireAuth)

discordRouter.get('/', async (req: AuthRequest, res) => {
  const link = await prisma.discordLink.findUnique({
    where: { userId: req.user!.id }, select: { verifiedAt: true, loginEnabledAt: true },
  })
  const oauthReady = !!discordOAuthSettings()
  res.json({
    configured: oauthReady && !!discordRoleSettings(), linked: !!link?.verifiedAt,
    accessConfigured: oauthReady, loginEnabled: !!link?.loginEnabledAt, guildId: env.DISCORD_GUILD_ID ?? null,
  })
})

function startDiscordFlow(purpose: Purpose) {
  return async (req: AuthRequest, res: Response) => {
    const config = discordOAuthSettings()
    if (!config || (purpose === 'community' && !discordRoleSettings())) {
      return res.status(503).json({ message: 'A autorização pelo Discord está indisponível.' })
    }
    const { id, sessionId } = req.user!
    const user = await prisma.user.findUnique({ where: { id }, select: { emailVerifiedAt: true } })
    if (!user?.emailVerifiedAt) return res.status(403).json({ message: 'Entre novamente com um perfil verificado.' })
    const state = randomToken()
    await prisma.discordLinkState.deleteMany({ where: { expiresAt: { lte: new Date() } } })
    await prisma.discordLinkState.create({ data: {
      stateHash: stateHash(state, purpose), sessionId, expiresAt: new Date(Date.now() + 10 * 60_000),
    } })
    const challenge = createHash('sha256').update(verifierFor(state, sessionId)).digest('base64url')
    return res.json({ state, url: discordAuthorizationUrl(config, state, challenge) })
  }
}

async function readAuthorizedIdentity(req: AuthRequest, res: Response, config: OAuthConfig, purpose: Purpose) {
  const parsed = codeInput.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Autorização inválida. Inicie novamente.' })
    return null
  }
  const { state, code } = parsed.data
  const { sessionId } = req.user!
  const consumed = await prisma.discordLinkState.deleteMany({
    where: { stateHash: stateHash(state, purpose), sessionId, expiresAt: { gt: new Date() } },
  })
  if (consumed.count !== 1) {
    res.status(400).json({ message: 'A autorização expirou ou pertence a outro fluxo. Inicie novamente.' })
    return null
  }
  try { return await discordIdentity(config, code, verifierFor(state, sessionId)) }
  catch {
    res.status(502).json({ message: 'Não foi possível validar sua conta no Discord. Tente novamente.' })
    return null
  }
}

async function reserveIdentity({ id, sessionId }: BrowserSession, discordUserId: string, res: Response) {
  const session = await prisma.userSession.findFirst({
    where: { id: sessionId, userId: id, revokedAt: null, expiresAt: { gt: new Date() }, user: {
      status: 'active', emailVerifiedAt: { not: null }, ...enabledIdentity,
    } }, select: { id: true },
  })
  if (!session) {
    res.status(401).json({ message: 'Sua sessão do SingleDrive expirou.' })
    return false
  }
  await prisma.discordLink.createMany({ data: [{ userId: id, discordUserId }], skipDuplicates: true })
  const link = await prisma.discordLink.findUnique({ where: { userId: id }, select: { discordUserId: true } })
  if (link?.discordUserId !== discordUserId) {
    res.status(409).json({ message: 'Uma dessas contas já está vinculada a outra conta.' })
    return false
  }
  return true
}

discordRouter.post('/access/start', discordLinkLimit, startDiscordFlow('access'))
discordRouter.post('/access/complete', discordLinkLimit, async (req: AuthRequest, res) => {
  const config = discordOAuthSettings()
  if (!config) return res.status(503).json({ message: 'A autorização pelo Discord está indisponível.' })
  const discordUserId = await readAuthorizedIdentity(req, res, config, 'access')
  if (!discordUserId || !await reserveIdentity(req.user!, discordUserId, res)) return
  await prisma.discordLink.update({ where: { userId: req.user!.id }, data: { loginEnabledAt: new Date() } })
  return res.json({ loginEnabled: true })
})

discordRouter.post('/start', discordLinkLimit, startDiscordFlow('community'))
discordRouter.post('/complete', discordLinkLimit, async (req: AuthRequest, res) => {
  const config = discordOAuthSettings()
  const roles = discordRoleSettings()
  if (!config || !roles) return res.status(503).json({ message: 'A verificação pelo Discord está indisponível.' })
  const discordUserId = await readAuthorizedIdentity(req, res, config, 'community')
  if (!discordUserId) return

  const memberPath = `/guilds/${roles.guildId}/members/${discordUserId}`
  try {
    const member = await discordBotRequest(roles.token, memberPath)
    if (member.status === 404) return res.status(409).json({ message: 'Entre no servidor SingleDrive no Discord e tente novamente.' })
    if (!member.ok) throw new Error('Discord membership check failed')
    if ((await member.json() as DiscordMember).pending) {
      return res.status(409).json({ message: 'Conclua a entrada no servidor SingleDrive e tente novamente.' })
    }
  } catch {
    return res.status(502).json({ message: 'Não foi possível conferir sua participação no servidor do Discord.' })
  }

  if (!await reserveIdentity(req.user!, discordUserId, res)) return
  try {
    for (const role of [roles.memberRoleId, roles.followingRoleId]) {
      if (!(await discordBotRequest(roles.token, memberPath + '/roles/' + role, 'PUT')).ok) throw new Error('Discord role grant failed')
    }
    await prisma.discordLink.update({ where: { userId: req.user!.id }, data: { verifiedAt: new Date() } })
  } catch {
    return res.status(502).json({ message: 'Não foi possível aplicar o cargo no Discord. Tente vincular novamente.' })
  }
  return res.json({ linked: true })
})
