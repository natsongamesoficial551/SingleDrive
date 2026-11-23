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
    user: { status: 'active' },
  }
  const accountId = device.remoteDiskAccountId
  const deviceMatches = where => (!where.id || where.id === device.id) && (!where.userId || where.userId === device.userId)
    && (!where.sessionId || where.sessionId === device.sessionId) && (!where.remoteDiskKeyHash || where.remoteDiskKeyHash === device.remoteDiskKeyHash)
    && (!where.remoteDiskEnabled || device.remoteDiskEnabled)
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
  replace(prisma.connectedAccount, 'findFirst', async ({ where }) =>
    where.id === accountId && where.userId === device.userId ? { id: accountId } : null)
  replace(prisma.user, 'update', async () => ({}))
  replace(prisma, '$transaction', async action => action(prisma))
  replace(googleService, 'getAuthedGoogleClient', async () => ({ getRequestHeaders: async () => new Headers() }))
  replace(google, 'drive', () => ({ files: {
    get: async ({ fileId }) => ({ data: entries.get(fileId) }),
    list: async ({ q }) => ({ data: { files: q.includes('appProperties')
      ? [root] : [...entries.values()].filter(item => !item.trashed && item.parents.includes(q.match(/^'([^']+)' in parents/)[1])) } }),
    create: async ({ requestBody, media }) => ({ data: newFile({ mimeType: media?.mimeType ?? 'application/octet-stream', ...requestBody }) }),
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
      else newFile({ ...upload.metadata, mimeType: 'application/octet-stream' }, content)
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
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
})
