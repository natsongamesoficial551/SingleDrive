import type { Request } from 'express'
import { isIP } from 'node:net'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { AuthRateLimitStore } from './auth-rate-limit.js'

const minute = 60_000
const normalLimit = 100
const limitOptions = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde e tente novamente.' },
} as const

export function clientIp(req: Request) {
  // O ingresso gerenciado do Render coloca o endereço do cliente no início da lista.
  if (process.env.RENDER === 'true') {
    const address = req.get('X-Forwarded-For')?.split(',', 1)[0]?.trim()
    if (address && isIP(address)) return address
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

const ipKey = (req: Request) => ipKeyGenerator(clientIp(req))
const sharedIngress = (req: Request) => clientIp(req) === '2a06:98c0:3600::103'
const trafficType = (req: Request) => /^\/remote-disk\/dav(?:\/|$)/i.test(req.path) ? 'dav' : 'http'

export const requestLimit = rateLimit({
  ...limitOptions,
  windowMs: minute,
  limit: req => sharedIngress(req) ? 600 : normalLimit,
  identifier: 'ip',
  keyGenerator: req => trafficType(req) + ':' + ipKey(req),
})

export const serviceLimit = rateLimit({
  ...limitOptions, windowMs: minute, limit: 1200, identifier: 'service',
  keyGenerator: trafficType,
  skip: req => req.method === 'GET' && req.path === '/health',
})

function authLimit(identifier: string, limit: number, windowMs: number) {
  return rateLimit({
    ...limitOptions, windowMs, limit: req => sharedIngress(req) ? normalLimit : limit, identifier, keyGenerator: ipKey,
    store: new AuthRateLimitStore(identifier),
    handler: (_req, res) => res.set('Cache-Control', 'no-store').status(429).json({
      code: 'AUTH_RATE_LIMITED', message: 'Muitas tentativas de acesso. Aguarde e tente novamente.',
    }),
    skip: req => req.method === 'OPTIONS',
  })
}

export const googleStartLimit = authLimit('google-start-v3', 12, 15 * minute)
export const googleCompleteLimit = authLimit('google-complete-v3', 40, 15 * minute)
export const refreshLimit = rateLimit({
  ...limitOptions, windowMs: minute, limit: req => sharedIngress(req) ? normalLimit : 30, identifier: 'refresh', keyGenerator: ipKey,
  skip: req => req.method === 'OPTIONS',
})

export const accountLimit = rateLimit({
  ...limitOptions, windowMs: minute, limit: normalLimit, identifier: 'account',
  keyGenerator: (req: Request & { user?: { id: string } }) => req.user!.id,
})

export const diskLimit = rateLimit({
  ...limitOptions, windowMs: minute, limit: normalLimit, identifier: 'disk',
  keyGenerator: (req: Request & { diskDeviceId?: string }) => req.diskDeviceId!,
})
