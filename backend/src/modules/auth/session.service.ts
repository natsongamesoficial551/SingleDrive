import type { Request, Response } from 'express'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'

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
export async function createSession(userId: string, req: Request) {
  const refreshToken = randomToken()
  const session = await prisma.userSession.create({ data: { userId, refreshTokenHash: hashToken(refreshToken),
    userAgent: req.header('User-Agent')?.slice(0, 1024), ipAddress: req.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000) } })
  return { accessToken: signAccessToken({ sub: userId, sid: session.id }), refreshToken }
}
