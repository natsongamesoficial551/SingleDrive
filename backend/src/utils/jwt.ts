import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export type AccessTokenPayload = {
  sub: string
  sid: string
}

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS })
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] })
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('Invalid access token payload')
  return payload as AccessTokenPayload
}
