import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../cloudflare/_worker.js'

test('Pages limita Google por IP sem consumir o orçamento de outro visitante', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'ok' }))
  const send = (ip, path = '/api/auth/google/start') => worker.fetch(new Request('https://unit.example' + path, {
    method: 'POST', headers: { 'CF-Connecting-IP': ip },
  }), {})
  for (let i = 0; i < 12; i++) assert.equal((await send('192.0.2.2')).status, 200)
  const blocked = await send('192.0.2.2')
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0)
  assert.equal((await blocked.json()).code, 'AUTH_RATE_LIMITED')
  assert.equal((await send('192.0.2.2', '/api/files')).status, 200)
  assert.equal((await send('192.0.2.3')).status, 200)
})
