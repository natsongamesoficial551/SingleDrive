const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

test('Discord separates server roles from logging in to the SingleDrive profile', async t => {
  Object.assign(process.env, {
    DATABASE_URL: 'mysql://unit:unit@127.0.0.1:1/unit',
    FRONTEND_URL: 'https://unit.example',
    JWT_ACCESS_SECRET: 'unit-only-not-production-01234567890123456789',
    TOKEN_ENCRYPTION_KEY: 'unit-only-not-production-01234567890123456789',
    DISCORD_CLIENT_ID: '100000000000000001',
    DISCORD_CLIENT_SECRET: 'unit-client-secret',
    DISCORD_BOT_TOKEN: 'unit-bot-token',
    DISCORD_GUILD_ID: '100000000000000002',
    DISCORD_MEMBER_ROLE_ID: '100000000000000003',
    DISCORD_FOLLOWING_ROLE_ID: '100000000000000004',
  })
  const express = require('express')
  const { prisma } = require('../dist/config/prisma.js')
  const { authRouter } = require('../dist/modules/auth/auth.routes.js')
  const { signAccessToken } = require('../dist/utils/jwt.js')
  const { errorMiddleware } = require('../dist/middleware/error.middleware.js')
  const discordId = '100000000000000005'
  let currentProfile = { id: discordId }
  const accounts = new Map([['user-a', { id: 'user-a', name: 'Perfil A', email: 'a@unit.example', status: 'active', emailVerifiedAt: new Date(), googleSubject: 'google-a' }]])
  const createdSessions = new Map()
  const states = new Map()
  const links = new Map()
  const grants = []
  let exchanges = 0
  let challenge
  let joined = true
  let failFollowing = false
  const sessionAccount = { first: 'user-a', other: 'user-a', second: 'user-b' }
  const session = id => sessionAccount[id] ? {
    userId: sessionAccount[id], revokedAt: null, expiresAt: new Date(Date.now() + 600_000),
    user: { status: 'active', googleSubject: 'google-user' },
  } : null

  const replace = (target, name, fn) => {
    const previous = target[name]
    target[name] = fn
    t.after(() => { target[name] = previous })
  }
  replace(prisma.userSession, 'findUnique', async ({ where }) => createdSessions.get(where.id) ?? session(where.id))
  replace(prisma.userSession, 'findFirst', async ({ where }) => createdSessions.get(where.id) ?? session(where.id))
  replace(prisma.user, 'findUnique', async ({ where }) => where.email
    ? [...accounts.values()].find(user => user.email === where.email) ?? null
    : accounts.get(where.id) ?? { emailVerifiedAt: new Date() })
  replace(prisma.user, 'findUniqueOrThrow', async ({ where }) => accounts.get(where.id))
  replace(prisma.user, 'count', async () => accounts.size)
  replace(prisma.user, 'create', async ({ data }) => {
    const { discordLink, ...fields } = data
    const user = { ...fields, id: 'user-discord', status: 'active', googleSubject: null }
    accounts.set(user.id, user)
    links.set(user.id, { ...discordLink.create, userId: user.id, verifiedAt: null })
    return user
  })
  replace(prisma.securityRateLimit, 'upsert', async () => ({ hits: 1 }))
  replace(prisma.securityRateLimit, 'deleteMany', async () => ({ count: 0 }))
  replace(prisma.discordLinkState, 'create', async ({ data }) => { states.set(data.stateHash, data); return data })
  replace(prisma.discordLinkState, 'deleteMany', async ({ where }) => {
    const candidate = states.get(where.stateHash)
    if (candidate?.sessionId !== where.sessionId || !candidate) return { count: 0 }
    states.delete(where.stateHash)
    return { count: 1 }
  })
  replace(prisma.discordLink, 'createMany', async ({ data: [pair] }) => {
    if (links.has(pair.userId) || [...links.values()].some(link => link.discordUserId === pair.discordUserId)) return { count: 0 }
    links.set(pair.userId, { ...pair, verifiedAt: null })
    return { count: 1 }
  })
  replace(prisma.discordLink, 'findUnique', async ({ where }) => {
    if (where.userId) return links.get(where.userId) ?? null
    const link = [...links.values()].find(value => value.discordUserId === where.discordUserId)
    return link ? { ...link, user: accounts.get(link.userId) } : null
  })
  replace(prisma.discordLink, 'update', async ({ where, data }) => Object.assign(links.get(where.userId), data))

  replace(prisma, '$transaction', async fn => fn(prisma))
  replace(prisma.user, 'update', async ({ where }) => ({ id: where.id }))
  replace(prisma.userSession, 'count', async () => 0)
  replace(prisma.userSession, 'create', async ({ data }) => {
    const id = 'test-session-' + (createdSessions.size + 1)
    createdSessions.set(id, { ...data, user: { ...accounts.get(data.userId), discordLink: links.get(data.userId) } })
    return { id }
  })

  const httpFetch = global.fetch
  t.mock.method(global, 'fetch', async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return httpFetch(url, init)
    const { pathname } = new URL(url)
    if (pathname.endsWith('/oauth2/token')) {
      exchanges++
      assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), challenge)
      return Response.json({ access_token: 'discord-user-token' })
    }
    if (pathname.endsWith('/users/@me')) {
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer discord-user-token')
      return Response.json(currentProfile)
    }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bot unit-bot-token')
    if (pathname.endsWith('/members/' + discordId)) return joined ? Response.json({ pending: false }) : new Response(null, { status: 404 })
    if (pathname.includes('/roles/') && init.method === 'PUT') {
      const roleId = pathname.split('/').at(-1)
      if (failFollowing && roleId === process.env.DISCORD_FOLLOWING_ROLE_ID) return new Response(null, { status: 503 })
      grants.push(roleId)
      return new Response(null, { status: 204 })
    }
    assert.fail('Unexpected Discord request: ' + pathname)
  })

  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  app.use(errorMiddleware)
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  function request(path, sessionId, body, origin = process.env.FRONTEND_URL, cookie) {
    return httpFetch(`http://127.0.0.1:${server.address().port}/auth/discord${path}`, {
      method: path ? 'POST' : 'GET',
      headers: {
        Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
        ...(sessionId ? { Authorization: 'Bearer ' + signAccessToken({ sub: sessionAccount[sessionId], sid: sessionId }) } : {}),
      },
      body: body && JSON.stringify(body),
    })
  }
  async function start(sessionId, route = '/start') {
    const response = await request(route, sessionId)
    assert.equal(response.status, 200)
    const url = new URL((await response.json()).url)
    assert.equal(url.searchParams.get('scope'), 'identify')
    assert.equal(url.searchParams.get('redirect_uri'), 'https://unit.example/discord/callback')
    challenge = url.searchParams.get('code_challenge')
    return { state: url.searchParams.get('state'), code: 'test-code' }
  }

  assert.equal((await request('/start')).status, 401)
  assert.equal((await request('/start', 'first', undefined, 'https://another.example')).status, 403)
  const initial = await start('first')
  assert.equal((await request('/complete', 'other', initial)).status, 400)
  assert.equal(exchanges, 0)

  joined = false
  assert.equal((await request('/complete', 'first', initial)).status, 409)
  assert.equal(grants.length, 0)
  assert.equal((await request('/complete', 'first', initial)).status, 400)

  joined = true
  failFollowing = true
  assert.equal((await request('/complete', 'first', await start('first'))).status, 502)
  assert.equal((await (await request('', 'first')).json()).linked, false)
  failFollowing = false
  assert.equal((await request('/complete', 'first', await start('first'))).status, 200)
  assert.deepEqual(grants.slice(-2), [process.env.DISCORD_MEMBER_ROLE_ID, process.env.DISCORD_FOLLOWING_ROLE_ID])
  assert.equal((await (await request('', 'first')).json()).linked, true)
  const grantCount = grants.length
  assert.equal((await request('/complete', 'second', await start('second'))).status, 409)
  assert.equal(grants.length, grantCount)

  async function beginLogin() {
    const response = await request('/login/start')
    assert.equal(response.status, 200)
    const setCookie = response.headers.getSetCookie()[0]
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Lax/)
    const { state, url } = await response.json()
    challenge = new URL(url).searchParams.get('code_challenge')
    return { state, cookie: setCookie.split(';', 1)[0] }
  }
  const unlinked = await beginLogin()
  const loginInput = { code: 'discord-login-code', state: unlinked.state }
  assert.equal((await request('/login/complete', null, loginInput)).status, 400)
  assert.equal((await request('/login/complete', null, loginInput, undefined, unlinked.cookie)).status, 409)
  joined = false
  const authorizeLogin = await start('first', '/access/start')
  assert.equal((await request('/complete', 'first', authorizeLogin)).status, 400)
  assert.equal((await request('/access/complete', 'other', authorizeLogin)).status, 400)
  assert.equal((await request('/access/complete', 'first', authorizeLogin)).status, 200)
  assert.equal((await (await request('', 'first')).json()).loginEnabled, true)
  assert.equal(grants.length, grantCount)
  const verifiedLogin = await beginLogin()
  const login = await request('/login/complete', null, { code: 'verified-code', state: verifiedLogin.state }, undefined, verifiedLogin.cookie)
  assert.equal(login.status, 200)
  assert.match(login.headers.getSetCookie().join(';'), /__Host-sd_refresh=/)
  assert.equal((await login.json()).user.id, 'user-a')
  assert.equal(grants.length, grantCount)

  const anotherDiscord = '100000000000000006'
  currentProfile = { id: anotherDiscord, email: 'a@unit.example', verified: true, username: 'Teste' }
  let attempt = await beginLogin()
  assert.equal((await request('/login/complete', null, { code: 'collision', state: attempt.state }, undefined, attempt.cookie)).status, 409)
  currentProfile = { ...currentProfile, email: 'new@unit.example', verified: false }
  attempt = await beginLogin()
  assert.equal((await request('/login/complete', null, { code: 'unverified', state: attempt.state }, undefined, attempt.cookie)).status, 403)
  currentProfile = { ...currentProfile, verified: true }
  attempt = await beginLogin()
  const created = await request('/login/complete', null, { code: 'new-profile', state: attempt.state }, undefined, attempt.cookie)
  assert.equal(created.status, 200)
  const newLogin = await created.json()
  assert.equal(newLogin.user.email, 'new@unit.example')
  assert.equal(links.get(newLogin.user.id).verifiedAt, null)
  assert.equal(grants.length, grantCount)
  const me = await httpFetch(`http://127.0.0.1:${server.address().port}/auth/me`, {
    headers: { Authorization: 'Bearer ' + newLogin.accessToken },
  })
  assert.equal(me.status, 200)
  assert.equal((await me.json()).user.id, newLogin.user.id)
})
