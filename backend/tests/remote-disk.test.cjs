const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

test('disco remoto lista, grava e controla acesso com Google Drive simulado', async t => {
  process.env.DATABASE_URL = 'mysql://unit:unit@127.0.0.1:1/sd_remote_unit'
  process.env.FRONTEND_URL = 'https://unit.example'
  process.env.JWT_ACCESS_SECRET = 'unit-only-not-production-01234567890123456789'
  process.env.TOKEN_ENCRYPTION_KEY = 'unit-only-not-production-01234567890123456789'
  const express = require('express')
  const { google } = require('googleapis')
  const undici = require('undici')
  const { prisma } = require('../dist/config/prisma.js')
  const googleService = require('../dist/modules/google/google.service.js')
  const quotaService = require('../dist/modules/storage/quota-refresh.js')
  const { signAccessToken } = require('../dist/utils/jwt.js')
  const { errorMiddleware } = require('../dist/middleware/error.middleware.js')
  let key = 'e'.repeat(43)
  const hash = value => createHash('sha256').update(value).digest('hex')
  const folderMime = 'application/vnd.google-apps.folder'
  const entries = new Map()
  const uploads = new Map()
  const newFile = (input, content = Buffer.alloc(0)) => {
    const id = randomUUID()
    const item = { ...input, id, version: '1', size: String(content.length), content, modifiedTime: '2026-11-23T12:00:00.000Z' }
    entries.set(id, item)
    return item
  }
  const root = newFile({ name: 'Disco remoto SingleDrive', mimeType: folderMime, parents: ['root'], appProperties: { singleDriveRemoteOwner: 'owner' } })
  const device = {
    id: randomUUID(), remoteDiskEnabled: true, remoteDiskKeyHash: hash(key), remoteDiskAccountId: randomUUID(),
    remoteDiskRootId: root.id, userId: 'owner', sessionId: 'pc', revokedAt: null,
    session: { client: 'desktop', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    user: { status: 'active', googleSubject: 'owner' },
  }
  const accountId = device.remoteDiskAccountId
  const secondId = randomUUID()
  const accounts = [{ id: accountId, userId: 'owner', provider: 'google_drive', status: 'connected' }]
  root.accountId = accountId
  const capacity = { totalBytes: 16_106_127_360n, usedBytes: 2_147_483_648n }
  let cachedQuota = { ...capacity, lastSyncedAt: new Date() }
  let secondQuota = { totalBytes: 32_212_254_720n, usedBytes: 1_073_741_824n, lastSyncedAt: new Date() }
  let refreshedAccounts = []
  const deviceMatches = where => (!where.id || where.id === device.id) && (!where.userId || where.userId === device.userId)
    && (!where.sessionId || where.sessionId === device.sessionId) && (!where.remoteDiskKeyHash || where.remoteDiskKeyHash === device.remoteDiskKeyHash)
    && (!where.remoteDiskEnabled || device.remoteDiskEnabled)
  const matchingAccounts = where => accounts.filter(account => account.userId === where.userId && (!where.id || where.id === account.id))
  let failUpload = false
  const replace = (object, method, action) => {
    const original = object[method]
    object[method] = action
    t.after(() => { object[method] = original })
  }
  replace(prisma.desktopDevice, 'findUnique', async ({ where }) => deviceMatches(where) ? device : null)
  replace(prisma.desktopDevice, 'findFirst', async ({ where }) => deviceMatches(where) ? device : null)
  replace(prisma.desktopDevice, 'updateMany', async ({ where, data }) => {
    if (!deviceMatches(where)) return { count: 0 }
    Object.assign(device, data)
    return { count: 1 }
  })
  replace(prisma.userSession, 'findUnique', async ({ where }) => ({
    ...device.session, userId: where.id === 'foreign' ? 'foreign' : 'owner', user: device.user,
    client: where.id.startsWith('pc') ? 'desktop' : 'web',
  }))
  replace(prisma.userSession, 'findUniqueOrThrow', async ({ where }) => ({ client: where.id.startsWith('pc') ? 'desktop' : 'web' }))
  replace(prisma.connectedAccount, 'findFirst', async ({ where }) => matchingAccounts(where)[0] ?? null)
  replace(prisma.connectedAccount, 'findMany', async ({ where }) => matchingAccounts(where))
  replace(prisma.storageAccount, 'findUnique', async ({ where }) => {
    return where.connectedAccountId === accountId ? cachedQuota : secondQuota
  })
  replace(quotaService, 'refreshAccountQuota', async account => {
    refreshedAccounts.push(account.id)
    return account.id === accountId ? { ...capacity, usedBytes: 3_221_225_472n } : secondQuota
  })
  replace(prisma.user, 'update', async () => ({}))
  replace(prisma, '$transaction', async action => action(prisma))
  replace(googleService, 'getAuthedGoogleClient', async account => ({ accountId: account.id, getRequestHeaders: async () => new Headers() }))
  replace(google, 'drive', ({ auth }) => ({ files: {
    get: async ({ fileId }) => ({ data: { ...entries.get(fileId) } }),
    list: async ({ q }) => ({ data: { files: q.includes('appProperties')
      ? [...entries.values()].filter(item => item.accountId === auth.accountId && item.appProperties?.singleDriveRemoteOwner === 'owner')
      : [...entries.values()].filter(item => !item.trashed && item.parents.includes(q.match(/^'([^']+)' in parents/)[1])).map(item => ({ ...item })) } }),
    create: async ({ requestBody, media }) => ({ data: newFile({ accountId: auth.accountId, mimeType: media?.mimeType ?? 'application/octet-stream', ...requestBody }) }),
    update: async ({ fileId, requestBody, media, addParents }) => {
      const item = entries.get(fileId)
      if (addParents) item.parents = [addParents]
      if (media) { item.content = Buffer.alloc(0); item.size = '0' }
      Object.assign(item, requestBody)
      return { data: item }
    },
  } }))
  replace(undici, 'fetch', async (input, options) => {
    const url = new URL(input)
    if (options.method === 'POST' || options.method === 'PATCH') {
      const id = randomUUID()
      const currentId = options.method === 'PATCH' ? url.pathname.split('/').at(-1) : null
      uploads.set(id, { currentId, metadata: JSON.parse(options.body) })
      return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + id } })
    }
    if (options.method === 'PUT') {
      const chunks = []
      for await (const chunk of options.body) chunks.push(chunk)
      assert.match(options.headers['Content-Range'], /^bytes 0-\d+\/\d+$/)
      if (failUpload) return new Response(null, { status: 503 })
      const upload = uploads.get(url.searchParams.get('upload_id'))
      const content = Buffer.concat(chunks)
      if (upload.currentId) Object.assign(entries.get(upload.currentId), { content, size: String(content.length) })
      else newFile({ ...upload.metadata, mimeType: 'application/octet-stream', accountId: entries.get(upload.metadata.parents[0]).accountId }, content)
      return new Response(null, { status: 200 })
    }
    const data = entries.get(url.pathname.split('/').at(-1)).content
    const range = options.headers.range
    if (range) {
      const [, first, last] = range.match(/bytes=(\d+)-(\d+)/)
      return new Response(data.subarray(+first, +last + 1), { status: 206, headers: { 'Content-Range': 'bytes ' + first + '-' + last + '/' + data.length, 'Content-Length': +last - +first + 1 } })
    }
    return new Response(data, { headers: { 'Content-Length': data.length } })
  })
  const { remoteDiskDavRouter, remoteDiskSettingsRouter } = require('../dist/modules/desktop-devices/remote-disk.routes.js')
  const app = express()
  app.use('/remote-disk/dav', remoteDiskDavRouter)
  app.use(express.json())
  app.use('/remote-disk', remoteDiskSettingsRouter)
  app.use(errorMiddleware)
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const dav = origin + '/remote-disk/dav/'
  const request = (method, path = '', extra = {}, body, token = key) =>
    fetch(dav + path, { method, headers: { Authorization: 'Bearer ' + token, ...extra }, body })
  const settings = (sid, path, method, body) => fetch(origin + '/remote-disk/' + path, {
    method, headers: { Authorization: 'Bearer ' + signAccessToken({ sub: sid === 'foreign' ? 'foreign' : 'owner', sid }), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await t.test('o próprio PC pode criar o disco e receber a chave de montagem', async () => {
    Object.assign(device, { remoteDiskEnabled: false, remoteDiskRootId: null, remoteDiskAccountId: null })
    assert.equal((await settings('pc', 'devices/' + device.id, 'PUT', { enabled: true, accountId })).status, 200)
    assert.equal(device.remoteDiskRootId, root.id)
    assert.equal(device.remoteDiskEnabled, true)
    const result = await settings('pc', 'mount-key', 'POST', {})
    assert.equal(result.status, 200)
    const data = await result.json()
    assert.match(data.key, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(device.remoteDiskKeyHash, hash(data.key))
    key = data.key
  })
  await t.test('chave exclusiva do PC, controles de sessão e pausa imediata', async () => {
    assert.equal((await request('PROPFIND', '', { Depth: '0' }, undefined, 'x'.repeat(43))).status, 401)
    assert.equal((await settings('web', 'mount-key', 'POST', {})).status, 409)
    assert.equal((await settings('pc-other', 'devices/' + device.id, 'PUT', { enabled: true })).status, 404)
    assert.equal((await settings('foreign', 'devices/' + device.id, 'PUT', { enabled: false })).status, 404)
    assert.equal((await settings('web', 'devices/' + device.id, 'PUT', { enabled: false })).status, 200)
    assert.equal((await request('PROPFIND', '', { Depth: '1' })).status, 403)
    assert.equal((await settings('pc', 'devices/' + device.id, 'PUT', { enabled: true })).status, 403)
    assert.equal((await settings('web', 'devices/' + device.id, 'PUT', { enabled: true })).status, 200)
    device.session.revokedAt = new Date()
    assert.equal((await request('PROPFIND', '', { Depth: '1' })).status, 401)
    device.session.revokedAt = null
  })
  await t.test('a raiz WebDAV informa apenas a cota da conta escolhida e atualiza a cota antiga', async () => {
    const report = async () => (await request('PROPFIND', '', { Depth: '0' })).text()
    assert.match(await report(), /<D:quota-used-bytes>2147483648<\/D:quota-used-bytes>/)
    assert.match(await report(), /<D:quota-available-bytes>13958643712<\/D:quota-available-bytes>/)
    assert.deepEqual(refreshedAccounts, [])
    cachedQuota.lastSyncedAt = new Date(0)
    assert.match(await report(), /<D:quota-used-bytes>3221225472<\/D:quota-used-bytes>/)
    assert.deepEqual(refreshedAccounts, [accountId])
    cachedQuota = { ...capacity, lastSyncedAt: new Date() }
  })
  await t.test('arquivos binários, vazios, caminhos Windows e lixeira recuperável', async () => {
    assert.equal((await request('MKCOL', 'Fam%C3%ADlia')).status, 201)
    assert.equal((await request('MKCOL', 'CON')).status, 400)
    assert.equal((await request('PUT', 'Fam%C3%ADlia/exemplo.json', { 'Content-Type': 'application/json' }, Buffer.from('{"ok":true}'))).status, 201)
    assert.equal((await request('PUT', 'vazio.txt', {}, Buffer.alloc(0))).status, 201)
    const props = await request('PROPFIND', 'Fam%C3%ADlia/', { Depth: '1' })
    assert.equal(props.status, 207)
    assert.match(await props.text(), /Fam%C3%ADlia\/exemplo\.json/)
    const partial = await request('GET', 'Fam%C3%ADlia/exemplo.json', { Range: 'bytes=2-3' })
    assert.equal(partial.status, 206)
    assert.equal(await partial.text(), 'ok')
    assert.equal((await request('HEAD', 'vazio.txt')).headers.get('content-length'), '0')
    assert.equal((await request('MOVE', 'Fam%C3%ADlia/exemplo.json', { Destination: '/remote-disk/dav/renomeado.json' })).status, 201)
    assert.equal(await (await request('GET', 'renomeado.json')).text(), '{"ok":true}')
    assert.equal((await request('DELETE', 'renomeado.json')).status, 204)
    assert.equal((await request('GET', 'renomeado.json')).status, 404)
    assert.equal((await request('DELETE')).status, 403)
    assert.equal([...entries.values()].find(item => item.name === 'renomeado.json').trashed, true)
  })
  await t.test('um envio com erro preserva a versão anterior', async () => {
    assert.equal((await request('PUT', 'relatorio.txt', {}, 'original')).status, 201)
    failUpload = true
    assert.equal((await request('PUT', 'relatorio.txt', {}, 'nova')).status, 503)
    assert.equal((await request('DELETE', 'relatorio.txt')).status, 409)
    assert.equal(await (await request('GET', 'relatorio.txt')).text(), 'original')
    failUpload = false
  })
  await t.test('o rclone real lista, envia e lê WebDAV', { skip: !process.env.SINGLEDRIVE_TEST_RCLONE }, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'singledrive-dav-'))
    try {
      const file = join(temporary, 'arquivo.txt')
      await writeFile(file, 'conteudo do rclone')
      const run = (...args) => promisify(execFile)(process.env.SINGLEDRIVE_TEST_RCLONE, [...args, '--config', 'NUL', '--retries', '1'], {
        env: { ...process.env, RCLONE_CONFIG_TEST_TYPE: 'webdav', RCLONE_CONFIG_TEST_URL: dav, RCLONE_CONFIG_TEST_VENDOR: 'other', RCLONE_CONFIG_TEST_BEARER_TOKEN: key },
      })
      await run('copyto', file, 'test:arquivo.txt')
      assert.match((await run('ls', 'test:')).stdout, /arquivo\.txt/)
      assert.equal((await run('cat', 'test:arquivo.txt')).stdout, 'conteudo do rclone')
      const quota = JSON.parse((await run('about', 'test:', '--json')).stdout)
      assert.deepEqual(quota, { total: 16_106_127_360, used: 2_147_483_648, free: 13_958_643_712 })
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
  await t.test('unifica cotas e pastas, distribui arquivos novos e preserva os existentes', async () => {
    accounts.push({ id: secondId, userId: 'owner', provider: 'google_drive', status: 'connected' })
    accounts.push({ id: randomUUID(), userId: 'foreign', provider: 'google_drive', status: 'connected' })
    const report = async () => (await request('PROPFIND', '', { Depth: '0' })).text()
    assert.match(await report(), /quota-available-bytes>13958643712/)
    assert.equal((await request('MKCOL', 'Documentos')).status, 201)
    assert.equal((await request('PUT', 'Documentos/antigo.txt', {}, 'primeira conta')).status, 201)
    assert.equal((await settings('web', 'devices/' + device.id, 'PUT', { enabled: true, poolEnabled: true })).status, 200)
    assert.match(await report(), /quota-available-bytes>45097156608/)
    assert.equal((await request('PUT', 'Documentos/novo.txt', {}, 'segunda conta')).status, 201)
    assert.equal([...entries.values()].find(item => item.name === 'novo.txt').accountId, secondId)
    assert.equal((await request('PUT', 'Documentos/antigo.txt', {}, 'editado')).status, 204)
    assert.equal([...entries.values()].find(item => item.name === 'antigo.txt').accountId, accountId)
    const listing = await (await request('PROPFIND', 'Documentos/', { Depth: '1' })).text()
    assert.match(listing, /Documentos\/antigo\.txt/)
    assert.match(listing, /Documentos\/novo\.txt/)
    assert.equal(await (await request('GET', 'Documentos/novo.txt')).text(), 'segunda conta')
    assert.equal((await request('MOVE', 'Documentos/', { Destination: '/remote-disk/dav/Documentos%202/' })).status, 201)
    assert.equal(await (await request('GET', 'Documentos%202/antigo.txt')).text(), 'editado')
    assert.equal(await (await request('GET', 'Documentos%202/novo.txt')).text(), 'segunda conta')
    const roots = await settings('web', 'devices/' + device.id + '/roots', 'GET')
    assert.deepEqual((await roots.json()).roots.map(item => item.accountId), [accountId, secondId])
    assert.equal((await settings('foreign', 'devices/' + device.id + '/roots', 'GET')).status, 404)
    assert.equal((await request('DELETE', 'Documentos%202/')).status, 204)
    assert.equal((await request('GET', 'Documentos%202/novo.txt')).status, 409)
    cachedQuota = { ...cachedQuota, usedBytes: cachedQuota.totalBytes - 1n }
    secondQuota = { ...secondQuota, usedBytes: secondQuota.totalBytes - 1n }
    assert.equal((await request('PUT', 'nao-cabe.txt', {}, 'ab')).status, 507)
  })
})
