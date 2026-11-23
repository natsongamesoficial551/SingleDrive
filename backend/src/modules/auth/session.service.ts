import type { Request, Response } from 'express'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'
import { clientIp } from '../../middleware/request-limits.js'
import { AccountCapacityError } from './account-capacity.js'

const secure = new URL(env.FRONTEND_URL).protocol === 'https:'
const cookieName = secure ? '__Host-sd_refresh' : 'sd_refresh_dev'
const options = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' }
export function setRefreshCookie(res: Response, token: string) {
  res.cookie(cookieName, token, { ...options, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000 })
}
export function clearRefreshCookie(res: Response) { res.clearCookie(cookieName, options) }
export function readRefreshCookie(req: Request) {
  const values = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`))
  if (values.length !== 1) return null
  const token = values[0]!.slice(cookieName.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}
export async function createSession(userId: string, req: Request, client: 'web' | 'android' | 'desktop' = 'web') {
  const refreshToken = randomToken()
  const session = await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() }, select: { id: true } })
    if (await tx.userSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }) >= 100) {
      throw new AccountCapacityError('SESSION_LIMIT_REACHED', 'Há 100 sessões ativas neste perfil. Encerre uma sessão em outro dispositivo para continuar.')
    }
    return tx.userSession.create({ data: { userId, client, refreshTokenHash: hashToken(refreshToken),
      userAgent: req.header('User-Agent')?.slice(0, 1024), ipAddress: clientIp(req),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000) } })
  }, { isolationLevel: 'ReadCommitted' })
  return { accessToken: signAccessToken({ sub: userId, sid: session.id }), refreshToken }
}
