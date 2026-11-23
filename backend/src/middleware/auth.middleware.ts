import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../config/prisma.js'
import { verifyAccessToken } from '../utils/jwt.js'
import { accountLimit } from './request-limits.js'

export type AuthRequest = Request & {
  user?: { id: string; sessionId: string }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.header('Authorization')
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Bearer token required.' })
    const payload = verifyAccessToken(header.slice(7))
    if (req.user?.id === payload.sub && req.user.sessionId === payload.sid) return next()
    const session = await prisma.userSession.findUnique({ where: { id: payload.sid }, include: { user: { select: { status: true, googleSubject: true } } } })
    if (!session || session.userId !== payload.sub || session.user.status !== 'active' || !session.user.googleSubject || session.revokedAt || session.expiresAt <= new Date()) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Entre com Google para continuar.' })
    req.user = { id: payload.sub, sessionId: payload.sid }
    return accountLimit(req, res, next)
  } catch {
    return res.status(401).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid token.' })
  }
}
