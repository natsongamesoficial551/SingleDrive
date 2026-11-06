const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { persistedOAuthFlow, normalizeOAuthFlow, oauthReturnTarget } = require('../dist/modules/auth/oauth-client.js')
test('web OAuth keeps existing callback and flows', () => {
  assert.equal(persistedOAuthFlow('login', 'web'), 'login')
  assert.equal(oauthReturnTarget('login', 'https://singledrive.netlify.app'), 'https://singledrive.netlify.app/google-auth')
})

test('native handlers keep PKCE, single-use state and initiating session checks', async t => {
  // All database methods reached by these tests are replaced below. No connection is opened.
  process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:1/sd_security_test_unit'
  process.env.FRONTEND_URL = 'https://unit.example'
  process.env.JWT_ACCESS_SECRET = 'unit-tests-only-not-production-01234567890123456789'
  process.env.TOKEN_ENCRYPTION_KEY = 'unit-tests-only-not-production-01234567890123456789'
  process.env.DOTENV_CONFIG_QUIET = 'true'
  const { prisma } = require('../dist/config/prisma.js')
  const { googleCallback, completeGoogleLogin } = require('../dist/modules/auth/oauth.service.js')
  const { signAccessToken } = require('../dist/utils/jwt.js')
  const verifier = 'a'.repeat(43)
  const state = { id: 'state-id', flow: 'android_connect', usedAt: null, expiresAt: new Date(Date.now() + 60000),
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'), providerConfig: { status: 'active' }, userId: 'owner', sessionId: 'original' }
  const originalFind = prisma.oauthState.findUnique
  const originalClaim = prisma.oauthState.updateMany
  const originalSession = prisma.userSession.findUnique
  let claims = 0
  prisma.oauthState.findUnique = async () => ({ ...state })
  prisma.oauthState.updateMany = async () => { claims++; return { count: 0 } }
  prisma.userSession.findUnique = async ({ where }) => ({ userId: 'owner', user: { status: 'active' }, revokedAt: null, expiresAt: new Date(Date.now() + 60000), id: where.id })
  function response() {
    return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v },
      status(code) { this.statusCode = code; return this }, json(data) { this.data = data; return this }, redirect(url) { this.location = url; return this } }
  }
  const handler = completeGoogleLogin(async () => { throw new Error('Unexpected session creation') })
  const request = (sid, verifierValue = verifier) => ({ body: { state: 's'.repeat(43), code: 'test-code', verifier: verifierValue },
    header: () => sid ? `Bearer ${signAccessToken({ sub: 'owner', sid })}` : undefined })
  const next = error => { if (error) throw error }
  try {
    await t.test('callback only passes code and state to the fixed native address', async () => {
      const res = response()
      await googleCallback({ query: { state: 's'.repeat(43), code: 'test-code', redirect_uri: 'https://attacker.invalid' } }, res)
      assert.equal(res.location, `app.singledrive.android://oauth#code=test-code&state=${'s'.repeat(43)}`)
      assert.equal(res.headers['Cache-Control'], 'no-store')
    })
    await t.test('wrong PKCE never claims state', async () => {
      const res = response(); await handler(request('original', 'b'.repeat(43)), res, next)
      assert.equal(res.statusCode, 401); assert.equal(claims, 0)
    })
    await t.test('missing initiating session is rejected', async () => {
      const res = response(); await handler(request(null), res, next)
      assert.equal(res.statusCode, 401); assert.equal(claims, 0)
    })
    await t.test('another session belonging to the same user is rejected', async () => {
      const res = response(); await handler(request('other-session'), res, next)
      assert.equal(res.statusCode, 403); assert.equal(claims, 0)
    })
    await t.test('state already claimed concurrently cannot exchange the code', async () => {
      const res = response(); await handler(request('original'), res, next)
      assert.equal(res.statusCode, 401); assert.equal(claims, 1)
    })
  } finally {
    prisma.oauthState.findUnique = originalFind
    prisma.oauthState.updateMany = originalClaim
    prisma.userSession.findUnique = originalSession
    await prisma.$disconnect()
  }
})
test('Android callback is fixed and preserves login/connect distinction', () => {
  for (const flow of ['login', 'connect']) {
    assert.equal(normalizeOAuthFlow(persistedOAuthFlow(flow, 'android')), flow)
    assert.equal(oauthReturnTarget(persistedOAuthFlow(flow, 'android'), 'https://example.test'), 'app.singledrive.android://oauth')
  }
  assert.equal(normalizeOAuthFlow('android_admin'), null)
  assert.equal(normalizeOAuthFlow('https://attacker.test'), null)
  assert.equal(oauthReturnTarget('https://attacker.test', 'https://example.test'), 'https://example.test/google-auth')
})
