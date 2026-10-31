import type { Request, Response } from 'express'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { hashPassword } from '../../utils/password.js'
import { createOAuthClient, syncGoogleQuota } from '../google/google.service.js'
import { setRefreshCookie } from './session.service.js'

export const oauthRouter = Router()
const challengeSchema = z.object({ codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), accessMode: z.enum(['essential', 'full']).default('essential') })
const completeSchema = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096), verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })

// A pasta do aplicativo pode ser gerida sem conceder acesso a todo o Drive.
export function googleScopesForMode(mode: string) {
  if (mode !== 'essential' && mode !== 'full') throw new Error('Invalid Google access mode')
  return ['openid', 'email', 'profile', mode === 'full' ? 'https://www.googleapis.com/auth/drive' : 'https://www.googleapis.com/auth/drive.file']
}

async function start(req: AuthRequest, res: Response, flow: 'login' | 'connect') {
  const { codeChallenge, accessMode } = challengeSchema.parse(req.body)
  // Login verifica identidade; acesso ao Drive é uma autorização separada.
  if (flow === 'login' && accessMode !== 'essential') return res.status(400).json({ code: 'GOOGLE_MODE_INVALID', message: 'Escolha acesso completo nas configurações após entrar.' })
  const config = await prisma.providerConfig.findFirstOrThrow({ where: { userId: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
  const state = randomToken()
  await prisma.oauthState.create({ data: {
    providerConfigId: config.id, flow, stateHash: hashToken(state), codeChallenge, accessMode,
    userId: flow === 'connect' ? req.user!.id : null,
    sessionId: flow === 'connect' ? req.user!.sessionId : null,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  } })
  const url = createOAuthClient(config).generateAuthUrl({ access_type: flow === 'login' ? 'online' : 'offline', prompt: flow === 'login' ? 'select_account' : 'consent', include_granted_scopes: false,
    scope: flow === 'login' ? ['openid', 'email', 'profile'] : googleScopesForMode(accessMode), state, code_challenge: codeChallenge, code_challenge_method: 'S256' as any })
  return res.json({ url, state })
}

oauthRouter.post('/google/start', async (req, res, next) => { try { return await start(req, res, 'login') } catch (error) { return next(error) } })
oauthRouter.post('/google/connect', requireAuth, async (req: AuthRequest, res, next) => { try { return await start(req, res, 'connect') } catch (error) { return next(error) } })

// O callback nunca troca o código nem grava credenciais. Somente o navegador que
// iniciou o fluxo possui o verifier necessário para concluir a troca.
export async function googleCallback(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store')
  const query = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).safeParse(req.query)
  if (!query.success) return res.redirect(`${env.FRONTEND_URL}/google-auth#status=error`)
  const state = await prisma.oauthState.findUnique({ where: { stateHash: hashToken(query.data.state) } })
  if (!state || state.usedAt || state.expiresAt <= new Date()) return res.redirect(`${env.FRONTEND_URL}/google-auth#status=error`)
  const fragment = new URLSearchParams({ code: query.data.code, state: query.data.state })
  return res.redirect(`${env.FRONTEND_URL}/google-auth#${fragment}`)
}

export function completeGoogleLogin(createSession: (userId: string, req: AuthRequest) => Promise<{ accessToken: string; refreshToken: string }>) {
  return async (req: AuthRequest, res: Response, next: import('express').NextFunction) => {
    try {
      const body = completeSchema.parse(req.body)
      const state = await prisma.oauthState.findUnique({ where: { stateHash: hashToken(body.state) }, include: { providerConfig: true } })
      const challenge = Buffer.from(hashToken(body.verifier), 'hex').toString('base64url')
      if (!state || state.usedAt || state.expiresAt <= new Date() || state.codeChallenge !== challenge || state.providerConfig.status !== 'active')
        return res.status(401).json({ code: 'GOOGLE_FLOW_INVALID', message: 'Inicie novamente a autorização neste navegador.' })
      if (state.flow !== 'login' && state.flow !== 'connect') return res.status(401).json({ code: 'GOOGLE_FLOW_INVALID', message: 'Fluxo inválido.' })
      if (state.flow === 'connect') {
        // Não aceitar apenas o verifier: a sessão autenticada iniciadora também deve continuar válida.
        let authenticated = false
        await requireAuth(req, res, () => { authenticated = true })
        if (!authenticated) return
        if (req.user!.id !== state.userId || req.user!.sessionId !== state.sessionId)
          return res.status(403).json({ code: 'GOOGLE_SESSION_MISMATCH', message: 'A sessão que iniciou a conexão mudou.' })
      }
      const claimed = await prisma.oauthState.updateMany({ where: { id: state.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
      if (claimed.count !== 1) return res.status(401).json({ code: 'GOOGLE_FLOW_INVALID', message: 'Autorização já utilizada.' })
      const client = createOAuthClient(state.providerConfig)
      const { tokens } = await client.getToken({ code: body.code, codeVerifier: body.verifier })
      if (!tokens.id_token || !tokens.access_token) throw new Error('GOOGLE_TOKENS_MISSING')
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: client._clientId })
      const profile = ticket.getPayload()
      if (!profile?.sub || !profile.email || profile.email_verified !== true) return res.status(403).json({ code: 'GOOGLE_IDENTITY_INVALID', message: 'O Google precisa verificar o endereço de e-mail.' })
      const email = profile.email.trim().toLowerCase()
      let user
      if (state.flow === 'login') {
        user = await prisma.user.findUnique({ where: { googleSubject: profile.sub } })
        if (!user) {
          // Nunca reaproveitar um cadastro por coincidência de e-mail.
          const legacy = await prisma.user.findUnique({ where: { email } })
          if (legacy) {
            // Exigir vínculo prévio com o mesmo sub, além do e-mail verificado.
            const link = await prisma.connectedAccount.findFirst({ where: { userId: legacy.id, provider: 'google_drive', providerAccountId: profile.sub, email, status: 'security_review_required' } })
            if (legacy.status !== 'security_review_required' || legacy.googleSubject || !link)
              return res.status(409).json({ code: 'GOOGLE_IDENTITY_CONFLICT', message: 'Esta conta exige recuperação ou vínculo pela sessão original.' })
            const recovered = await prisma.user.updateMany({ where: { id: legacy.id, status: 'security_review_required', googleSubject: null }, data: {
              googleSubject: profile.sub, emailVerifiedAt: new Date(), status: 'active', passwordHash: await hashPassword(randomToken()),
            } })
            if (recovered.count !== 1) return res.status(409).json({ code: 'GOOGLE_IDENTITY_CONFLICT', message: 'Tente entrar novamente.' })
            user = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })
          } else {
            user = await prisma.user.create({ data: { email, name: profile.name || email, googleSubject: profile.sub, emailVerifiedAt: new Date(), passwordHash: await hashPassword(randomToken()) } })
          }
        }
      } else {
        user = await prisma.user.findUniqueOrThrow({ where: { id: state.userId! } })
      }
      if (user.status !== 'active') return res.status(403).json({ code: 'ACCOUNT_REVIEW_REQUIRED', message: 'A conta exige revisão de segurança.' })
      if (state.flow === 'login') {
        const { accessToken, refreshToken } = await createSession(user.id, req)
        setRefreshCookie(res, refreshToken)
        return res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email } })
      }
      const grants = tokens.scope?.split(/\s+/) ?? []
      const googleScopes = googleScopesForMode(state.accessMode)
      const allowed = new Set([...googleScopes, 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'])
      if (!grants.includes(googleScopes[3]!) || grants.some(scope => !allowed.has(scope)))
        return res.status(403).json({ code: 'GOOGLE_SCOPE_RECONSENT', message: 'Revogue a autorização anterior no Google e conecte novamente com a permissão escolhida.' })
      client.setCredentials(tokens)
      // Grants antigos de escopo amplo não devem ser reaproveitados implicitamente.
      if (!tokens.refresh_token) return res.status(400).json({ code: 'GOOGLE_CONSENT_REQUIRED', message: 'Revogue a autorização anterior no Google e conecte novamente.' })
      const data = { providerConfigId: state.providerConfigId, email, displayName: profile.name, avatarUrl: profile.picture,
        accessTokenEncrypted: encryptText(tokens.access_token), refreshTokenEncrypted: encryptText(tokens.refresh_token),
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000), scopes: googleScopes, status: 'connected' }
      const account = await prisma.$transaction(async tx => {
        if (email === user.email.toLowerCase()) {
          await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), ...(user.googleSubject ? {} : { googleSubject: profile.sub }) } })
        }
        return tx.connectedAccount.upsert({ where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId: profile.sub } },
          create: { ...data, userId: user.id, provider: 'google_drive', providerAccountId: profile.sub }, update: data })
      })
      await syncGoogleQuota(account.id).catch(() => undefined)
      return res.json({ status: 'connected' })
    } catch (error) { return next(error) }
  }
}
