const { test } = require('node:test')
const assert = require('node:assert/strict')

process.env.DATABASE_URL = 'mysql://unit:unit@127.0.0.1:1/sd_limits_unit'
process.env.FRONTEND_URL = 'https://unit.example'
process.env.JWT_ACCESS_SECRET = 'unit-only-not-production-01234567890123456789'
process.env.TOKEN_ENCRYPTION_KEY = 'unit-only-not-production-01234567890123456789'

const { prisma } = require('../dist/config/prisma.js')
const { app } = require('../dist/app.js')
const { registerGoogleProfile, reserveStorageAccount } = require('../dist/modules/auth/account-capacity.js')

test('o limite geral inclui rotas públicas, login legado e WebDAV', async t => {
  app.set('trust proxy', 1) // O cliente de teste conecta ao proxy diretamente.
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  async function send(path, client, method = 'GET') {
    const response = await fetch(base + path, {
      method, headers: { Origin: process.env.FRONTEND_URL, 'X-Forwarded-For': client },
    })
    return { status: response.status, headers: response.headers, body: await response.text() }
  }

  for (const path of ['/auth/login', '/auth/register']) {
    const response = await send(path, '192.0.2.10', 'POST')
    assert.equal(response.status, 410)
    assert.equal(JSON.parse(response.body).code, 'GOOGLE_LOGIN_ONLY')
  }
  for (let i = 0; i < 100; i++) assert.equal((await send('/health', '192.0.2.11')).status, 200)
  const limited = await send('/auth/login', '192.0.2.11', 'POST')
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  assert.equal((await send('/health', '192.0.2.12')).status, 200)

  for (let i = 0; i < 100; i++) assert.equal((await send('/remote-disk/dav/', '192.0.2.12')).status, 401)
  assert.equal((await send('/remote-disk/dav/', '192.0.2.12')).status, 429)
  assert.equal((await send('/health', '192.0.2.12')).status, 200)
})

test('100 perfis: cadastro novo é bloqueado, login existente é preservado', async t => {
  const identity = { email: 'owner@example.test', name: 'Pessoa', googleSubject: 'subject' }
  let count = 99
  let saved
  const original = prisma.$transaction
  t.after(() => { prisma.$transaction = original })
  prisma.$transaction = async (operation, options) => {
    assert.equal(options.isolationLevel, 'Serializable')
    return operation({ user: {
      findUnique: async ({ where }) => where.googleSubject === saved?.googleSubject || where.email === saved?.email ? saved : null,
      count: async () => count,
      create: async ({ data }) => { count++; return saved = { id: 'owner', ...data } },
    } })
  }
  assert.equal((await registerGoogleProfile(identity)).id, 'owner')
  await assert.rejects(registerGoogleProfile({ ...identity, email: 'extra@example.test', googleSubject: 'extra' }),
    { code: 'ACCOUNT_LIMIT_REACHED' })
  assert.equal((await registerGoogleProfile(identity)).id, 'owner')
})

test('a cota de armazenamento é comum a Google Drive e S3 e permite atualizar uma conexão ativa', async () => {
  const tx = {
    user: { update: async () => ({ id: 'owner' }) },
    connectedAccount: {
      count: async ({ where }) => { assert.deepEqual(where, { userId: 'owner', status: 'connected' }); return 100 },
      findUnique: async ({ where }) => where.userId_provider_providerAccountId.providerAccountId === 'active' ? { status: 'connected' } : null,
    },
  }
  for (const provider of ['google_drive', 's3']) {
    await assert.rejects(reserveStorageAccount(tx, 'owner', provider, 'extra'), { code: 'STORAGE_ACCOUNT_LIMIT_REACHED' })
    await reserveStorageAccount(tx, 'owner', provider, 'active')
  }
})
