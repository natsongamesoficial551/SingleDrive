const { test, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')

// Recusar execução destrutiva fora do banco descartável local.
const target = new URL(process.env.DATABASE_URL || 'mysql://invalid')
if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/sd_security_test')) throw new Error('Use somente um banco local sd_security_test* descartável.')
process.env.FRONTEND_URL = 'https://security-test.example'
process.env.JWT_ACCESS_SECRET = 'local-tests-only-012345678901234567890123456789'
process.env.TOKEN_ENCRYPTION_KEY = 'local-tests-only-012345678901234567890123456789'
process.env.SYSTEM_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001'
const { app } = require('../dist/app.js')
const { prisma } = require('../dist/config/prisma.js')
const { encryptText, randomToken, hashToken } = require('../dist/utils/crypto.js')
const { signAccessToken } = require('../dist/utils/jwt.js')
const { createS3Client } = require('../dist/modules/s3/s3.service.js')
const { google } = require('googleapis')
let server, base, config, a, b, permissionWrites = 0, tokenExchanges = 0, uploads = 0
const profiles = new Map()
const originalFetch = global.fetch
const originalDrive = google.drive
const proto = google.auth.OAuth2.prototype
const originals = { getToken: proto.getToken, verifyIdToken: proto.verifyIdToken, revokeToken: proto.revokeToken }
const sha = text => createHash('sha256').update(text).digest('base64url')
const origin = process.env.FRONTEND_URL
async function request(path, { method = 'GET', token, body, cookie, headers = {}, redirect = 'follow' } = {}) {
  const response = await originalFetch(base + path, { method, redirect,
    headers: { Origin: origin, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, headers: response.headers, data }
}
async function register(email) {
  const result = await request('/auth/register', { method: 'POST', body: { name: 'Pessoa de teste', email, password: 'Senha-local-teste-123!' } })
  assert.equal(result.status, 201, JSON.stringify(result.data))
  assert.equal(result.data.refreshToken, undefined)
  assert.match(result.headers.get('set-cookie'), /HttpOnly/i)
  assert.match(result.headers.get('set-cookie'), /Secure/i)
  assert.match(result.headers.get('set-cookie'), /SameSite=Lax/i)
  return { ...result.data, cookie: result.headers.get('set-cookie').split(';')[0] }
}
async function flow(token, mode = 'essential') {
  const verifier = randomToken()
  const result = await request(token ? '/auth/google/connect' : '/auth/google/start', { method: 'POST', token, body: { codeChallenge: sha(verifier), accessMode: mode } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  return { ...result.data, verifier }
}
function code(email, sub = email, scope = 'openid email profile https://www.googleapis.com/auth/drive.file', verified = true) {
  const value = randomUUID()
  profiles.set(value, { email, sub, email_verified: verified, scope, name: 'Google de teste' })
  return value
}
async function complete(pending, authorizationCode, token, overrides = {}) {
  return request('/auth/google/complete', { method: 'POST', token, body: { state: pending.state, verifier: pending.verifier, code: authorizationCode, ...overrides } })
}
async function connect(owner, email, mode = 'essential') {
  const pending = await flow(owner.accessToken, mode)
  const result = await complete(pending, code(email, email, `openid email profile https://www.googleapis.com/auth/${mode === 'full' ? 'drive' : 'drive.file'}`), owner.accessToken)
  assert.equal(result.status, 200, JSON.stringify(result.data))
  return prisma.connectedAccount.findFirstOrThrow({ where: { userId: owner.user.id, providerAccountId: email } })
}

before(async () => {
  await prisma.user.deleteMany()
  await prisma.providerConfig.deleteMany()
  config = await prisma.providerConfig.create({ data: { userId: null, provider: 'google_drive', clientIdEncrypted: encryptText('test-client'), clientSecretEncrypted: encryptText('test-secret'), redirectUri: 'https://backend-test.example/connected-accounts/google/callback', scopes: ['openid'] } })
  proto.getToken = async function (options) {
    tokenExchanges++
    assert.match(options.codeVerifier, /^[A-Za-z0-9_-]{43}$/)
    const profile = profiles.get(options.code)
    if (!profile) throw new Error('Código de teste inválido')
    return { tokens: { id_token: options.code, access_token: 'fake-access', refresh_token: 'fake-refresh', expiry_date: Date.now() + 3600_000, scope: profile.scope } }
  }
  proto.verifyIdToken = async options => {
    assert.equal(options.audience, 'test-client')
    return { getPayload: () => profiles.get(options.idToken) }
  }
  proto.revokeToken = async () => ({ data: {} })
  google.drive = () => ({
    about: { get: async () => ({ data: { storageQuota: { limit: '99999999', usage: '0' } } }) },
    files: {
      list: async () => ({ data: { files: [{ id: 'app-root', name: '9drive' }] } }),
      get: async () => ({ data: { webViewLink: 'https://drive.google.com/mock-private-link' } }),
      create: async params => { if (params.media) for await (const chunk of params.media.body) assert.ok(chunk.length); uploads++; return { data: { id: 'uploaded-' + uploads, name: params.requestBody.name, mimeType: params.media?.mimeType || 'application/octet-stream' } } },
      update: async () => ({ data: {} }),
    },
    permissions: { create: async () => { permissionWrites++; throw new Error('Publicação indevida') } },
  })
  global.fetch = async (url, options) => String(url).startsWith('https://www.googleapis.com/')
    ? new Response('<script>test</script>', { headers: { 'content-type': 'text/html' } }) : originalFetch(url, options)
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  a = await register('a@example.test')
  b = await register('b@example.test')
})
beforeEach(async () => { await prisma.securityRateLimit.deleteMany() })
after(async () => {
  global.fetch = originalFetch
  google.drive = originalDrive
  Object.assign(proto, originals)
  if (server) await new Promise(resolve => server.close(resolve))
  await prisma.$disconnect()
})

test('cadastro por senha não é associado a um login Google pelo e-mail', async () => {
  const pending = await flow()
  const response = await complete(pending, code(a.user.email))
  assert.equal(response.status, 409)
  assert.equal((await prisma.user.findUnique({ where: { id: a.user.id } })).googleSubject, null)
  assert.equal(await prisma.connectedAccount.count({ where: { userId: a.user.id } }), 0)
})
test('callback de outro navegador não grava tokens; verifier errado, ausente e sessão alheia são recusados', async () => {
  const pending = await flow(a.accessToken)
  const authorizationCode = code('second@example.test')
  const calls = tokenExchanges
  const callback = await request(`/connected-accounts/google/callback?state=${pending.state}&code=${authorizationCode}`, { redirect: 'manual' })
  assert.equal(callback.status, 302)
  assert.match(callback.headers.get('location'), /google-auth#code=/)
  assert.equal(tokenExchanges, calls)
  assert.equal((await complete(pending, authorizationCode, a.accessToken, { verifier: randomToken() })).status, 401)
  assert.equal((await complete(pending, authorizationCode)).status, 401)
  assert.equal((await complete(pending, authorizationCode, b.accessToken)).status, 403)
  const otherSession = await request('/auth/login', { method: 'POST', body: { email: a.user.email, password: 'Senha-local-teste-123!' } })
  assert.equal((await complete(pending, authorizationCode, otherSession.data.accessToken)).status, 403)
  assert.equal(tokenExchanges, calls)
  assert.equal((await complete(pending, authorizationCode, a.accessToken)).status, 200)
  assert.equal((await complete(pending, authorizationCode, a.accessToken)).status, 401)
})
test('estado expirado e duas conclusões concorrentes não reaproveitam autorização', async () => {
  const expired = await flow(a.accessToken)
  await prisma.oauthState.updateMany({ where: { stateHash: hashToken(expired.state) }, data: { expiresAt: new Date(0) } })
  assert.equal((await complete(expired, code('expired@example.test'), a.accessToken)).status, 401)
  const pending = await flow(a.accessToken)
  const authorizationCode = code('concurrent@example.test')
  const results = await Promise.all([complete(pending, authorizationCode, a.accessToken), complete(pending, authorizationCode, a.accessToken)])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401])
})
test('login usa sub verificado estável e não solicita acesso ao Drive', async () => {
  const pending = await flow()
  assert.equal(new URL(pending.url).searchParams.get('scope'), 'openid email profile')
  const result = await complete(pending, code('google-login@example.test', 'stable-sub'))
  assert.equal(result.status, 200)
  assert.equal(result.data.refreshToken, undefined)
  const again = await complete(await flow(), code('changed@example.test', 'stable-sub'))
  assert.equal(again.status, 200)
  assert.equal(again.data.user.id, result.data.user.id)
  assert.equal(await prisma.connectedAccount.count({ where: { userId: result.data.user.id } }), 0)
  assert.equal((await complete(await flow(), code('unverified@example.test', 'not-verified', 'openid email profile', false))).status, 403)
})
test('modo essencial rejeita grant amplo; modo completo exige escolha autenticada explícita', async () => {
  const essential = await flow(a.accessToken)
  assert.match(new URL(essential.url).searchParams.get('scope'), /drive\.file/)
  const response = await complete(essential, code('overbroad@example.test', 'overbroad', 'openid email profile https://www.googleapis.com/auth/drive'), a.accessToken, { accessMode: 'full' })
  assert.equal(response.status, 403)
  const account = await connect(a, 'full@example.test', 'full')
  assert.ok(account.scopes.includes('https://www.googleapis.com/auth/drive'))
  const loginFull = await request('/auth/google/start', { method: 'POST', body: { codeChallenge: sha(randomToken()), accessMode: 'full' } })
  assert.equal(loginFull.status, 400)
})

test('recuperação legada exige sub e vínculo prévios; não libera tokens nem contas suspensas', async () => {
  const legacy = await prisma.user.create({ data: { name: 'Legado', email: 'legacy@example.test', passwordHash: 'invalid', status: 'security_review_required' } })
  const link = await prisma.connectedAccount.create({ data: { userId: legacy.id, providerConfigId: config.id, provider: 'google_drive', providerAccountId: 'legacy-sub', email: legacy.email, scopes: [], status: 'security_review_required', refreshTokenEncrypted: encryptText('old-token') } })
  assert.equal((await complete(await flow(), code(legacy.email, 'wrong-sub'))).status, 409)
  const recovered = await complete(await flow(), code(legacy.email, 'legacy-sub'))
  assert.equal(recovered.status, 200)
  assert.equal(recovered.data.user.id, legacy.id)
  assert.equal((await prisma.connectedAccount.findUniqueOrThrow({ where: { id: link.id } })).status, 'security_review_required')
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: legacy.email, password: 'invalid' } })).status, 401)
  await prisma.user.update({ where: { id: legacy.id }, data: { status: 'suspended' } })
  assert.equal((await complete(await flow(), code(legacy.email, 'legacy-sub'))).status, 403)
})

test('reconexão muda escopo e desconexão invalida tokens, streams e compartilhamentos', async () => {
  const account = await connect(a, 'reconsent@example.test', 'full')
  const reduced = await connect(a, 'reconsent@example.test', 'essential')
  assert.equal(reduced.id, account.id)
  assert.deepEqual(reduced.scopes, ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'])
  const file = await prisma.file.create({ data: { userId: a.user.id, connectedAccountId: account.id, provider: 'google_drive', providerFileId: 'disconnect-file', name: 'privado.txt', mimeType: 'text/plain', sizeBytes: 1n } })
  const shared = await request(`/files/${file.id}/share`, { method: 'POST', token: a.accessToken })
  const shareToken = shared.data.url.split('/').pop()
  assert.equal((await request(`/connected-accounts/${account.id}`, { method: 'DELETE', token: a.accessToken })).status, 200)
  const disconnected = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } })
  assert.equal(disconnected.refreshTokenEncrypted, null)
  assert.equal(disconnected.accessTokenEncrypted, null)
  assert.equal(disconnected.status, 'disconnected')
  assert.equal((await request(`/public/files/${shareToken}`)).status, 404)
})

test('upload resumível valida dono, tamanho e estado sem criar ACL pública', async () => {
  const account = await connect(a, 'resumable@example.test')
  const session = await prisma.uploadSession.create({ data: { userId: a.user.id, targetConnectedAccountId: account.id, fileName: 'resume.txt', mimeType: 'text/plain', sizeBytes: 3n, status: 'uploading', googleSessionUri: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=local-test' } })
  const path = `/uploads/resumable/chunk/${session.id}`
  assert.equal((await request(path, { method: 'PUT', token: b.accessToken, headers: { 'Content-Range': 'bytes 0-2/3' } })).status, 404)
  for (const range of ['bytes 0-2/4', 'bytes 2-1/3', 'bytes 0-3/3', 'bytes 0-2/3 extra']) {
    assert.equal((await request(path, { method: 'PUT', token: a.accessToken, headers: { 'Content-Range': range } })).status, 400)
  }
  const savedFetch = global.fetch
  global.fetch = async (url, options) => {
    if (String(url) === session.googleSessionUri) {
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.get('content-length'), '3')
      let size = 0
      for await (const chunk of options.body) size += chunk.length
      assert.equal(size, 3)
      return Response.json({ id: 'resumed-private-file', name: 'resume.txt', mimeType: 'text/plain' })
    }
    return savedFetch(url, options)
  }
  try {
    const result = await originalFetch(base + path, { method: 'PUT', headers: { Origin: origin, Authorization: `Bearer ${a.accessToken}`, 'Content-Range': 'bytes 0-2/3', 'Content-Type': 'application/octet-stream' }, body: 'abc' })
    assert.equal(result.status, 201, await result.text())
    assert.equal((await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })).status, 'completed')
    assert.equal((await request(path, { method: 'PUT', token: a.accessToken, headers: { 'Content-Range': 'bytes 0-2/3' } })).status, 400)
    assert.equal(permissionWrites, 0)
  } finally { global.fetch = savedFetch }
})
test('cookie HttpOnly rotaciona; token JSON, origem alheia e refresh repetido são recusados', async () => {
  const first = await request('/auth/refresh', { method: 'POST', cookie: a.cookie, body: {} })
  assert.equal(first.status, 200)
  assert.equal((await request('/auth/refresh', { method: 'POST', cookie: a.cookie, body: {} })).status, 401)
  assert.equal((await request('/auth/refresh', { method: 'POST', body: { refreshToken: a.cookie.split('=')[1] } })).status, 401)
  const cookie = first.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/auth/refresh', { method: 'POST', cookie, body: {}, headers: { Origin: 'https://attacker.example' } })).status, 403)
  const results = await Promise.all([request('/auth/refresh', { method: 'POST', cookie, body: {} }), request('/auth/refresh', { method: 'POST', cookie, body: {} })])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401])
})
test('JWT não pode combinar usuário com sessão de outro usuário', async () => {
  const session = await prisma.userSession.findFirstOrThrow({ where: { userId: b.user.id } })
  const forged = signAccessToken({ sub: a.user.id, sid: session.id })
  assert.equal((await request('/auth/me', { token: forged })).status, 401)
})
test('isolamento de arquivos, pastas e contas conectadas entre A e B', async () => {
  const account = await connect(a, 'owned@example.test')
  const file = await prisma.file.create({ data: { userId: a.user.id, connectedAccountId: account.id, provider: 'google_drive', providerFileId: 'owned-file', name: 'privado.txt', mimeType: 'text/plain', sizeBytes: 11n } })
  for (const suffix of ['', '/download', '/view-url']) assert.equal((await request(`/files/${file.id}${suffix}`, { token: b.accessToken })).status, 404)
  for (const suffix of ['/share', '/preview-token']) assert.equal((await request(`/files/${file.id}${suffix}`, { method: 'POST', token: b.accessToken })).status, 404)
  assert.equal((await request(`/files/${file.id}`, { method: 'PATCH', token: b.accessToken, body: { name: 'tomado' } })).status, 404)
  assert.equal((await request(`/connected-accounts/${account.id}/browse`, { token: b.accessToken })).status, 404)
  assert.equal((await request(`/connected-accounts/${account.id}`, { method: 'DELETE', token: b.accessToken })).status, 404)
  assert.equal((await request(`/files/${file.id}`, { token: a.accessToken })).status, 200)
  assert.equal((await prisma.file.findUnique({ where: { id: file.id } })).name, 'privado.txt')
})
test('upload e cópia de link não tornam arquivo público; compartilhamento é revogável', async () => {
  const form = new FormData()
  form.set('sizeBytes', '11'); form.set('fileName', 'privado.txt'); form.set('file', new Blob(['hello world'], { type: 'text/plain' }), 'privado.txt')
  const result = await request('/uploads', { method: 'POST', token: a.accessToken, body: form })
  assert.equal(result.status, 201, JSON.stringify(result.data))
  const id = result.data.file.id
  assert.equal((await request(`/files/${id}/view-url`, { token: a.accessToken })).status, 200)
  assert.equal((await request(`/files/${id}/public-permission`, { method: 'POST', token: a.accessToken })).status, 410)
  assert.equal(permissionWrites, 0)
  const shared = await request(`/files/${id}/share`, { method: 'POST', token: a.accessToken })
  const shareToken = shared.data.url.split('/').pop()
  assert.equal((await request(`/public/files/${shareToken}`)).status, 200)
  assert.equal((await request(`/files/${id}/share`, { method: 'DELETE', token: a.accessToken })).status, 200)
  assert.equal((await request(`/public/files/${shareToken}`)).status, 404)
})
test('conteúdo HTML em preview é download e recebe CSP sandbox, sem cache', async () => {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { userId: a.user.id, status: 'connected' } })
  const file = await prisma.file.create({ data: { userId: a.user.id, connectedAccountId: account.id, provider: 'google_drive', providerFileId: 'html-file', name: 'teste\r\n.html', mimeType: 'text/html', sizeBytes: 22n } })
  const shared = await request(`/files/${file.id}/share`, { method: 'POST', token: a.accessToken })
  const shareToken = shared.data.url.split('/').pop()
  const response = await request(`/public/files/${shareToken}/preview`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition'), /^attachment;/)
  assert.match(response.headers.get('content-security-policy'), /sandbox/)
  assert.match(response.headers.get('cache-control'), /no-store/)
  await prisma.connectedAccount.update({ where: { id: account.id }, data: { status: 'disconnected' } })
  assert.equal((await request(`/public/files/${shareToken}`)).status, 404)
})
test('endpoints S3 arbitrários não disparam requisições nem persistem contas', async () => {
  const before = await prisma.connectedAccount.count()
  for (const endpoint of ['http://127.0.0.1:8080', 'https://169.254.169.254', 'https://[::1]']) {
    assert.equal((await request('/connected-accounts/s3', { method: 'POST', token: b.accessToken, body: { name: 'SSRF', bucket: 'test', region: 'us-east-1', endpoint, accessKeyId: 'test', secretAccessKey: 'test' } })).status, 400)
    assert.throws(() => createS3Client({ endpoint, region: 'us-east-1' }), /disabled/)
  }
  assert.equal(await prisma.connectedAccount.count(), before)
  const client = createS3Client({ endpoint: null, region: 'us-east-1', accessKeyIdEncrypted: encryptText('test'), secretAccessKeyEncrypted: encryptText('test') })
  client.destroy()
})
test('usuário comum não acessa administração; sessão de conta suspensa é recusada', async () => {
  for (const [method, path] of [['GET', '/system/backup'], ['POST', '/system/google-config'], ['POST', '/system/restore'], ['POST', '/system/update']])
    assert.equal((await request(path, { method, token: a.accessToken })).status, 403)
  await prisma.user.update({ where: { id: b.user.id }, data: { status: 'security_review_required' } })
  assert.equal((await request('/auth/me', { token: b.accessToken })).status, 401)
  await prisma.user.update({ where: { id: b.user.id }, data: { status: 'active' } })
})
test('metadados multipart inválidos não derrubam o processo', async () => {
  const form = new FormData(); form.set('filesMeta', '{invalido'); form.set('file', new Blob(['x']), 'x')
  assert.equal((await request('/uploads', { method: 'POST', token: a.accessToken, body: form })).status, 400)
  assert.equal((await request('/health')).status, 200)
})

test('convites não expõem metadados a quem cadastrou e-mail sem verificá-lo', async () => {
  const account = await connect(a, 'invite-owner@example.test')
  const file = await prisma.file.create({ data: { userId: a.user.id, connectedAccountId: account.id, provider: 'google_drive', providerFileId: 'invite-private', name: 'nome-confidencial.txt', mimeType: 'text/plain', sizeBytes: 1n } })
  const sent = await request('/invites', { method: 'POST', token: a.accessToken, body: { email: b.user.email, targetType: 'file', targetId: file.id } })
  assert.equal(sent.status, 201)
  assert.equal(sent.data.invite.status, 'pending')
  assert.deepEqual((await request('/invites', { token: b.accessToken })).data.received, [])
  await prisma.user.update({ where: { id: b.user.id }, data: { emailVerifiedAt: new Date() } })
  assert.equal((await request('/invites', { token: b.accessToken })).data.received[0].target.name, file.name)
})

test('API key válida funciona e deixa de funcionar quando o dono é suspenso', async () => {
  const key = await request('/api-keys', { method: 'POST', token: b.accessToken, body: { name: 'integração de teste' } })
  assert.equal(key.status, 201)
  const form = () => { const data = new FormData(); data.set('filesMeta', '{invalid'); return data }
  assert.equal((await request('/api/v1/uploads', { method: 'POST', token: key.data.secret, body: form() })).status, 400)
  await prisma.user.update({ where: { id: b.user.id }, data: { status: 'suspended' } })
  assert.equal((await request('/api/v1/uploads', { method: 'POST', token: key.data.secret, body: form() })).status, 401)
  await prisma.user.update({ where: { id: b.user.id }, data: { status: 'active' } })
  assert.equal((await request(`/api-keys/${key.data.apiKey.id}`, { method: 'DELETE', token: b.accessToken })).status, 200)
  assert.equal((await request('/api/v1/uploads', { method: 'POST', token: key.data.secret, body: form() })).status, 401)
})
test('limitação por conta sobrevive à troca de processo e normaliza e-mail', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'missing@example.test', password: 'wrong' } })).status, 401)
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'MISSING@example.test', password: 'wrong' } })).status, 429)
  const { AuthRateLimitStore } = require('../dist/middleware/auth-rate-limit.js')
  const otherProcess = new AuthRateLimitStore('account')
  assert.equal((await otherProcess.increment('missing@example.test')).totalHits, 12)
})
test('overrides de dependências preservam geração ZIP e leitura de configuração Prisma', async () => {
  const { ZipArchive } = await import('archiver')
  const archive = new ZipArchive()
  const chunks = []
  archive.on('data', chunk => chunks.push(chunk))
  const done = new Promise((resolve, reject) => { archive.once('end', resolve); archive.once('error', reject) })
  archive.append('controle', { name: 'controle.txt' })
  await archive.finalize(); await done
  assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), 'PK')
  const { deepmerge } = await import('deepmerge-ts')
  assert.deepEqual(deepmerge({ nested: { a: 1 } }, { nested: { b: 2 } }), { nested: { a: 1, b: 2 } })
})
