const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

test('vínculos de PC respeitam conta, tipo de sessão e revogação', async t => {
  process.env.DATABASE_URL = 'mysql://unit:unit@127.0.0.1:1/sd_security_test_desktop_unit'
  process.env.FRONTEND_URL = 'https://unit.example'
  process.env.JWT_ACCESS_SECRET = 'unit-only-not-production-01234567890123456789'
  process.env.TOKEN_ENCRYPTION_KEY = 'unit-only-not-production-01234567890123456789'
  const express = require('express')
  const { prisma } = require('../dist/config/prisma.js')
  const { desktopDeviceRouter } = require('../dist/modules/desktop-devices/desktop-device.routes.js')
  const { backupRouter, relativePath } = require('../dist/modules/desktop-devices/backup.routes.js')
  const { fileRouter } = require('../dist/modules/files/file.routes.js')
  const { encryptText, decryptText } = require('../dist/utils/crypto.js')
  const { errorMiddleware } = require('../dist/middleware/error.middleware.js')
  const { signAccessToken } = require('../dist/utils/jwt.js')
  const now = () => new Date()
  const sessions = new Map([
    ['pc-a', { id: 'pc-a', userId: 'a', client: 'desktop' }],
    ['web-a', { id: 'web-a', userId: 'a', client: 'web' }],
    ['pc-b', { id: 'pc-b', userId: 'b', client: 'desktop' }],
  ].map(([id, value]) => [id, { ...value, user: { status: 'active', googleSubject: value.userId }, revokedAt: null, expiresAt: new Date(Date.now() + 3600000) }]))
  const devices = []
  const roots = []
  const entries = []
  let fileFilter
  const patches = []
  const replace = (object, key, value) => { const original = object[key]; patches.push(() => { object[key] = original }); object[key] = value }
  const matches = (device, where) => (!where.id || device.id === where.id) && (!where.userId || device.userId === where.userId) &&
    (!where.sessionId || device.sessionId === where.sessionId) && (where.revokedAt !== null || device.revokedAt === null)
  replace(prisma.user, 'update', async () => ({}))
  replace(prisma.desktopDevice, 'count', async ({ where }) => devices.filter(device => matches(device, where) && !sessions.get(device.sessionId).revokedAt && sessions.get(device.sessionId).expiresAt > now()).length)
  replace(prisma.userSession, 'findUnique', async ({ where }) => sessions.get(where.id) ?? null)
  replace(prisma.userSession, 'findUniqueOrThrow', async ({ where }) => sessions.get(where.id))
  replace(prisma.userSession, 'updateMany', async ({ where, data }) => {
    const session = sessions.get(where.id)
    if (!session || session.userId !== where.userId) return { count: 0 }
    Object.assign(session, data); return { count: 1 }
  })
  replace(prisma.desktopDevice, 'findUnique', async ({ where }) => devices.find(device => device.sessionId === where.sessionId) ?? null)
  replace(prisma.desktopDevice, 'findUniqueOrThrow', async ({ where }) => devices.find(device => device.sessionId === where.sessionId))
  replace(prisma.desktopDevice, 'findFirst', async ({ where }) => devices.find(device => matches(device, where)) ?? null)
  replace(prisma.desktopDevice, 'findMany', async ({ where }) => devices.filter(device => device.userId === where.userId).map(device => ({ ...device, session: sessions.get(device.sessionId) })))
  replace(prisma.desktopDevice, 'upsert', async ({ where, create, update }) => {
    let device = devices.find(value => value.sessionId === where.sessionId)
    if (device) Object.assign(device, update)
    else { device = { id: randomUUID(), ...create, backupEnabled: false, runtimeStatus: 'idle', uploadedFiles: 0, revokedAt: null, createdAt: now(), lastSeenAt: now(), lastBackupAt: null }; devices.push(device) }
    return device
  })
  replace(prisma.desktopDevice, 'updateMany', async ({ where, data }) => {
    const matched = devices.filter(device => matches(device, where))
    matched.forEach(device => Object.assign(device, data)); return { count: matched.length }
  })
  replace(prisma.desktopDevice, 'update', async ({ where, data }) => { const device = devices.find(device => device.id === where.id); Object.assign(device, data); return device })
  replace(prisma, '$transaction', async callback => callback(prisma))
  replace(prisma.backupRoot, 'findMany', async ({ where }) => roots.filter(root => root.userId === where.userId))
  replace(prisma.backupRoot, 'findFirst', async ({ where }) => roots.find(root => root.id === where.id && root.userId === where.userId) ?? null)
  replace(prisma.backupRoot, 'upsert', async ({ create }) => { const root = { id: randomUUID(), ...create }; roots.push(root); return root })
  replace(prisma.file, 'findFirst', async ({ where }) => where.userId === 'a' ? { id: where.id, sizeBytes: 123n } : null)
  replace(prisma.file, 'findMany', async ({ where }) => { fileFilter = where; return [] })
  replace(prisma.backupEntry, 'upsert', async ({ create }) => { entries.push(create); return create })
  replace(prisma.backupEntry, 'findMany', async ({ where }) => entries.filter(entry => entry.rootId === where.rootId))
  const app = express(); app.use(express.json()); app.use('/desktop-devices', desktopDeviceRouter); app.use('/backups', backupRouter); app.use('/files', fileRouter); app.use(errorMiddleware)
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)) })
  const base = `http://127.0.0.1:${server.address().port}`
  async function request(sessionId, path = '', method = 'GET', body) {
    const session = sessions.get(sessionId)
    const response = await fetch(base + (/^\/(backups|files)/.test(path) ? '' : '/desktop-devices') + path, { method,
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${signAccessToken({ sub: session.userId, sid: sessionId })}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  const registration = { name: 'Meu computador', platform: 'windows', appVersion: '0.2.0' }
  let deviceId
  try {
    await t.test('exige autenticação e impede registrar a sessão do site como PC', async () => {
      assert.equal((await request('unknown')).status, 401)
      assert.equal((await request('web-a', '/register', 'POST', registration)).status, 403)
      assert.equal(devices.length, 0)
    })
    await t.test('registro é idempotente por sessão e começa sem backup autorizado', async () => {
      const first = await request('pc-a', '/register', 'POST', registration)
      deviceId = first.data.device.id
      assert.equal(first.status, 200); assert.equal(first.data.device.backupEnabled, false)
      assert.equal((await request('pc-a', '/register', 'POST', registration)).data.device.id, deviceId)
      assert.equal(devices.length, 1)
    })
    await t.test('outra conta não lista, pausa ou revoga o PC', async () => {
      assert.deepEqual((await request('pc-b')).data.devices, [])
      assert.equal((await request('pc-b', '/' + deviceId, 'PATCH', { backupEnabled: true })).status, 404)
      assert.equal((await request('pc-b', '/' + deviceId, 'DELETE')).status, 404)
      assert.equal(sessions.get('pc-a').revokedAt, null)
    })
    await t.test('lista não expõe identificador de sessão ou refresh token', async () => {
      const device = (await request('web-a')).data.devices[0]
      assert.equal(device.sessionId, undefined); assert.equal(device.userId, undefined)
      assert.equal(device.refreshTokenHash, undefined); assert.equal(device.online, true)
    })
    await t.test('navegação separa arquivos da raiz, de uma pasta e busca global', async () => {
      assert.equal((await request('web-a', '/files?root=1')).status, 200)
      assert.equal(fileFilter.folderId, null)
      await request('web-a', '/files?folderId=subpasta')
      assert.equal(fileFilter.folderId, 'subpasta')
      await request('web-a', '/files?q=contrato')
      assert.equal(fileFilter.folderId, undefined)
      assert.equal(fileFilter.name.contains, 'contrato')
    })
    await t.test('heartbeat só atualiza a própria sessão vinculada e entrega pausa/retomada', async () => {
      const body = { runtimeStatus: 'idle', sourceNames: ['Documentos'], uploadedFiles: 3, completedScan: true }
      assert.equal((await request('pc-b', '/heartbeat', 'POST', body)).status, 403)
      assert.equal((await request('pc-a', '/heartbeat', 'POST', body)).data.backupEnabled, false)
      assert.equal((await request('web-a', '/' + deviceId, 'PATCH', { backupEnabled: true })).status, 200)
      assert.equal((await request('pc-a', '/heartbeat', 'POST', body)).data.backupEnabled, true)
      assert.equal(devices[0].uploadedFiles, 3); assert.ok(devices[0].lastBackupAt)
      assert.equal((await request('pc-a', '/heartbeat', 'POST', { ...body, runtimeStatus: 'execute' })).status, 400)
    })
    let backupId
    await t.test('catálogo criptografado guarda subpastas e isola contas', async () => {
      const root = await request('pc-a', '/backups/roots', 'POST', { name: 'Projetos', machine: 'PC', originalPath: 'C:\\Users\\Antigo\\Documents\\Projetos', anchor: 'MyDocuments', suffix: 'Projetos' })
      assert.equal(root.status, 200); backupId = root.data.id
      assert.equal(roots[0].metadata.includes('Antigo'), false)
      assert.equal(JSON.parse(decryptText(roots[0].metadata)).suffix, 'Projetos')
      const body = { relativePath: '2026/contrato.pdf', fileId: randomUUID(), sha256: 'a'.repeat(64), modifiedUtc: new Date().toISOString() }
      assert.equal((await request('pc-a', '/backups/' + backupId + '/entries', 'POST', body)).status, 200)
      assert.equal((await request('pc-a', '/backups/' + backupId + '/entries', 'POST', { relativePath: 'vazia', kind: 'directory' })).status, 200)
      assert.equal((await request('pc-a', '/backups/' + backupId + '/entries', 'POST', { relativePath: 'zero.txt', kind: 'empty', modifiedUtc: new Date().toISOString() })).status, 200)
      assert.equal((await request('pc-b', '/backups/' + backupId + '/entries')).status, 404)
      assert.deepEqual((await request('pc-b', '/backups')).data.roots, [])
      assert.equal((await request('web-a', '/backups/' + backupId + '/entries')).data.entries[0].relativePath, body.relativePath)
      assert.equal((await request('pc-a', '/backups/' + backupId + '/entries', 'POST', { ...body, relativePath: '../fora.txt' })).status, 400)
      for (const path of ['C:/absoluto', 'a\\b', '/absoluto', 'a//b', 'CON.txt', 'a:stream', 'a/../b', 'arquivo.']) assert.equal(relativePath.safeParse(path).success, false)
      assert.notEqual(encryptText('mesmo'), encryptText('mesmo'))
    })
    await t.test('revogação invalida a sessão do agente e preserva a sessão do site', async () => {
      assert.equal((await request('web-a', '/' + deviceId, 'DELETE')).status, 200)
      assert.ok(sessions.get('pc-a').revokedAt)
      assert.equal((await request('pc-a')).status, 401)
      const remaining = await request('web-a')
      assert.equal(remaining.status, 200); assert.equal(remaining.data.devices[0].revoked, true)
      assert.equal(remaining.data.devices[0].online, false)
      assert.equal((await request('web-a', '/backups/' + backupId + '/entries')).data.entries.length, 3)
    })
    await t.test('aceita dez PCs, bloqueia o décimo primeiro e libera vaga após revogação', async () => {
      for (let i = 0; i < 11; i++) sessions.set('extra-' + i, { id: 'extra-' + i, userId: 'a', client: 'desktop', user: { status: 'active', googleSubject: 'a' }, revokedAt: null, expiresAt: new Date(Date.now() + 3600000) })
      const linked = []
      for (let i = 0; i < 10; i++) {
        const result = await request('extra-' + i, '/register', 'POST', registration)
        assert.equal(result.status, 200); linked.push(result.data.device.id)
      }
      assert.equal((await request('extra-0', '/register', 'POST', registration)).status, 200)
      const rejected = await request('extra-10', '/register', 'POST', registration)
      assert.equal(rejected.status, 409); assert.equal(rejected.data.code, 'DEVICE_LIMIT_REACHED')
      await request('web-a', '/' + linked[0], 'DELETE')
      assert.equal((await request('extra-10', '/register', 'POST', registration)).status, 200)
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
    patches.reverse().forEach(restore => restore())
    await prisma.$disconnect()
  }
})
