const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { PrismaClient } = require('@prisma/client')

test('upgrade preserva dados e suspensões, revoga sessões e coloca vínculos ativos em revisão', async () => {
  const url = new URL(process.env.DATABASE_URL || 'mysql://invalid')
  if (url.hostname !== '127.0.0.1' || !/^\/sd_security_test_upgrade_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Use banco local novo sd_security_test_upgrade_*; não reaproveite banco com dados.')
  const db = new PrismaClient()
  try {
    const postgres = url.protocol === 'postgresql:' || url.protocol === 'postgres:'
    const tables = await db.$queryRawUnsafe(postgres ? "SELECT tablename FROM pg_tables WHERE schemaname = 'public'" : 'SHOW TABLES')
    assert.equal(tables.length, 0, 'O banco de upgrade deve estar vazio.')
    const root = join(__dirname, postgres ? '../prisma-postgres/migrations' : '../prisma/migrations')
    const names = readdirSync(root).filter(name => /^\d/.test(name)).sort()
    const securityMigration = '20261031210000_security_identity_boundary'
    const apply = async name => {
      const sql = readFileSync(join(root, name, 'migration.sql'), 'utf8').replace(/^\s*--.*$/gm, '')
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement)
    }
    for (const name of names.filter(name => name !== securityMigration)) await apply(name)
    const active = randomUUID(), suspended = randomUUID(), passwordOnly = randomUUID()
    for (const [id, status] of [[active, 'active'], [suspended, 'suspended'], [passwordOnly, 'active']]) {
      await db.$executeRawUnsafe(`INSERT INTO users (id,name,email,password_hash,status,updated_at) VALUES (${postgres ? '$1, $2, $3, $4, $5' : '?, ?, ?, ?, ?'}, NOW())`, id, 'Teste de upgrade', `${id}@example.test`, 'invalid', status)
    }
    const accounts = []
    for (const id of [active, suspended]) accounts.push(await db.connectedAccount.create({ data: { userId: id, provider: 'google_drive', providerAccountId: id, email: `${id}@example.test`, scopes: [], refreshTokenEncrypted: 'audit-marker' } }))
    const disconnected = await db.connectedAccount.create({ data: { userId: active, provider: 'google_drive', providerAccountId: 'disconnected', email: 'disconnected@example.test', scopes: [], status: 'disconnected' } })
    const session = await db.userSession.create({ data: { userId: active, refreshTokenHash: 'old-hash', expiresAt: new Date(Date.now() + 3600000) } })
    const apiKey = await db.apiKey.create({ data: { userId: active, name: 'old', keyPrefix: 'old', keyHash: 'old-key', scopes: [] } })
    const file = await db.file.create({ data: { userId: active, connectedAccountId: accounts[0].id, provider: 'google_drive', providerFileId: 'preserved', name: 'preservado.txt', mimeType: 'text/plain', sizeBytes: 42n } })
    const share = await db.fileShare.create({ data: { userId: active, fileId: file.id, tokenHash: 'old-share' } })
    await apply(securityMigration)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: active } })).status, 'security_review_required')
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: suspended } })).status, 'suspended')
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: passwordOnly } })).status, 'active')
    assert.ok((await db.userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt)
    assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } })).status, 'revoked')
    assert.equal((await db.fileShare.findUniqueOrThrow({ where: { id: share.id } })).enabled, false)
    assert.equal((await db.connectedAccount.findUniqueOrThrow({ where: { id: disconnected.id } })).status, 'disconnected')
    for (const account of accounts) {
      const row = await db.connectedAccount.findUniqueOrThrow({ where: { id: account.id } })
      assert.equal(row.status, 'security_review_required')
      assert.equal(row.refreshTokenEncrypted, 'audit-marker')
    }
    assert.equal((await db.file.findUniqueOrThrow({ where: { id: file.id } })).sizeBytes, 42n)
  } finally { await db.$disconnect() }
})
