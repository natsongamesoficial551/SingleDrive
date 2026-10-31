import { test } from 'node:test'
import assert from 'node:assert/strict'

test('system routes require the configured administrator', async () => {
  const adminId = '11111111-1111-4111-8111-111111111111'
  const otherId = '22222222-2222-4222-8222-222222222222'
  process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test'
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.JWT_ACCESS_SECRET = 'test-only-jwt-secret-32-characters-long'
  process.env.TOKEN_ENCRYPTION_KEY = 'test-only-encryption-key-32-characters-long'
  process.env.SYSTEM_ADMIN_USER_ID = adminId

  const { app } = await import('../src/app.js')
  const { prisma } = await import('../src/config/prisma.js')
  const { signAccessToken } = await import('../src/utils/jwt.js')
  const originalSession = prisma.userSession.findUnique
  const originalConfig = prisma.providerConfig.findFirst
  prisma.userSession.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60_000), revokedAt: null })) as typeof originalSession
  prisma.providerConfig.findFirst = (async () => null) as typeof originalConfig
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}/system/google-config`
    assert.equal((await fetch(url)).status, 401)
    const header = (id: string) => ({ Authorization: `Bearer ${signAccessToken({ sub: id, sid: 'session-test' })}` })
    assert.equal((await fetch(url, { headers: header(otherId) })).status, 403)
    assert.equal((await fetch(url, { headers: header(adminId) })).status, 200)
  } finally {
    prisma.userSession.findUnique = originalSession
    prisma.providerConfig.findFirst = originalConfig
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await prisma.$disconnect()
  }
})
