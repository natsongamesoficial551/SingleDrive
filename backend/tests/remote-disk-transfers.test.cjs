const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Readable } = require('node:stream')
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = require('undici')

process.env.DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/sd_remote_disk_test'
process.env.FRONTEND_URL = 'https://unit.example'
process.env.JWT_ACCESS_SECRET = 'unit-only-not-production-01234567890123456789'
process.env.TOKEN_ENCRYPTION_KEY = 'unit-only-not-production-01234567890123456789'

const { openPublicDownload, publicAddress, publicDownloadUrl } = require('../dist/modules/desktop-devices/public-download.js')
const { saveDriveStream } = require('../dist/modules/desktop-devices/drive-stream-upload.js')
const { previousDisk } = require('../dist/modules/desktop-devices/disk-recovery.js')

test('importação aceita somente endereços públicos e não confia em IP literal', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::ffff:127.0.0.1']) {
    assert.equal(publicAddress(ip), false)
  }
  assert.equal(publicAddress('8.8.8.8'), true)
  for (const url of ['http://2130706433', 'http://[::1]', 'http://site.local/a', 'https://a:b@example.com', 'http://example.com:8080', 'file:///a']) {
    assert.throws(() => publicDownloadUrl(url), { status: 400 })
  }
  await assert.rejects(() => openPublicDownload('http://127.0.0.1/fake-file', AbortSignal.timeout(1000)), { status: 400 })
  assert.equal(publicDownloadUrl('https://example.com/file.zip?key=123').pathname, '/file.zip')
})

test('restauração procura discos da mesma conta, inclusive de um vínculo revogado', async () => {
  const calls = []
  const original = { remoteDiskAccountId: 'drive-antigo', remoteDiskPoolEnabled: true }
  const db = { desktopDevice: { async findFirst(query) { calls.push(query); return calls.length === 1 ? null : original } } }
  assert.equal(await previousDisk(db, { id: 'novo', userId: 'dono', name: 'PC' }), original)
  assert.equal(calls[0].where.name.equals, 'PC')
  assert.deepEqual(calls[1].where, { id: { not: 'novo' }, userId: 'dono', remoteDiskAccountId: { not: null }, remoteDiskRootId: { not: null } })
})

test('envio para o Drive usa partes e confirma tamanho antes de indicar sucesso', async () => {
  const previous = getGlobalDispatcher()
  const agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  try {
    const pool = agent.get('https://www.googleapis.com')
    const path = '/upload/drive/v3/files?upload_id=unit'
    const part = 16 * 1024 ** 2
    const data = Buffer.alloc(part)
    const parent = { id: 'pasta' }
    pool.intercept({ method: 'POST', path: '/upload/drive/v3/files?uploadType=resumable&fields=id,size' })
      .reply(200, {}, { headers: { location: 'https://www.googleapis.com' + path } })
    pool.intercept({ method: 'PUT', path, headers: { 'content-range': `bytes 0-${part - 1}/*` } })
      .reply(308, '', { headers: { range: `bytes=0-${part - 1}` } })
    pool.intercept({ method: 'PUT', path, headers: { 'content-range': `bytes ${part}-${part}/${part + 1}` } })
      .reply(200, { id: 'arquivo', size: String(part + 1) })
    const progress = []
    await saveDriveStream(Readable.from([data, Buffer.from('a')]), {}, new Headers(), parent,
      'arquivo.zip', undefined, part * 2, AbortSignal.timeout(10000), undefined, sent => progress.push(sent))
    assert.deepEqual(progress, [part, part + 1])
    await assert.rejects(
      saveDriveStream(Readable.from([Buffer.from('a')]), {}, new Headers(), parent,
        'incompleto.zip', 2, part, AbortSignal.timeout(1000)),
      { status: 422 },
    )
    agent.assertNoPendingInterceptors()
  } finally {
    setGlobalDispatcher(previous)
    await agent.close()
  }
})
