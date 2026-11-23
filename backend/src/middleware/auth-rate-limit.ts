import type { Store, Options } from 'express-rate-limit'
import { prisma } from '../config/prisma.js'
import { hashToken } from '../utils/crypto.js'

// Contadores compartilhados entre processos; reinício do Node não zera tentativas.
export class AuthRateLimitStore implements Store {
  windowMs = 15 * 60_000
  private nextCleanup = 0
  constructor(private readonly namespace: string) {}
  init(options: Options) { this.windowMs = options.windowMs }
  private id(key: string, now = Date.now()) { return `${this.namespace}:${hashToken(key)}:${Math.floor(now / this.windowMs)}` }
  async increment(key: string) {
    const now = Date.now()
    const resetTime = new Date((Math.floor(now / this.windowMs) + 1) * this.windowMs)
    const id = this.id(key, now)
    const record = await prisma.securityRateLimit.upsert({ where: { id }, create: { id, hits: 1, expiresAt: resetTime }, update: { hits: { increment: 1 } } })
    if (now >= this.nextCleanup) {
      this.nextCleanup = now + 60_000
      void prisma.securityRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now - this.windowMs) } } }).catch(() => undefined)
    }
    return { totalHits: record.hits, resetTime }
  }
  async decrement(key: string) { await prisma.securityRateLimit.updateMany({ where: { id: this.id(key), hits: { gt: 0 } }, data: { hits: { decrement: 1 } } }) }
  async resetKey(key: string) { await prisma.securityRateLimit.deleteMany({ where: { id: this.id(key) } }) }
}
