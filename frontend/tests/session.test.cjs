const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(require.resolve('../src/lib/api.ts'), 'utf8').replaceAll('import.meta.env.PROD', 'true').replaceAll('import.meta.env.VITE_API_URL', 'undefined')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function client(fetch, locks) {
  const state = { token: 'old', user: { id: 'owner' }, cleared: 0 }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, navigator: { locks }, Headers, FormData, fetch,
    require: () => ({ getAccessToken: () => state.token, getStoredUser: () => state.user,
      clearAuthSession: () => { state.token = null; state.user = null; state.cleared++ },
      setAuthSession: (token, user) => { state.token = token; state.user = user } }),
  })
  return { api: exports, state }
}
const refreshed = () => Response.json({ accessToken: 'new', user: { id: 'owner' } })

test('rede, 429 e 503 preservam a sessão e permitem nova tentativa', async () => {
  for (const status of [0, 429, 503]) {
    let calls = 0
    const c = client(async () => { if (++calls > 1) return refreshed(); if (!status) throw new Error('offline'); return Response.json({ message: 'temporário' }, { status }) })
    await assert.rejects(c.api.restoreSession())
    assert.equal(c.state.token, 'old'); assert.equal(c.state.cleared, 0)
    assert.equal(await c.api.restoreSession(), true)
  }
})
test('401 de refresh encerra a sessão de fato', async () => {
  const c = client(async () => new Response(null, { status: 401 }))
  assert.equal(await c.api.restoreSession(), false)
  assert.equal(c.state.token, null)
})
test('401 em conclusão OAuth não apaga a sessão existente', async () => {
  const c = client(async () => Response.json({ message: 'state inválido' }, { status: 401 }))
  await assert.rejects(c.api.apiFetch('/auth/google/complete', { method: 'POST', retry: false }))
  assert.equal(c.state.token, 'old')
})
test('requisições concorrentes na mesma aba compartilham uma renovação', async () => {
  let refreshes = 0
  const c = client(async url => { assert.match(url, /refresh$/); refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return refreshed() })
  await Promise.all([c.api.restoreSession(), c.api.restoreSession(), c.api.restoreSession()])
  assert.equal(refreshes, 1)
})
test('abas e popup serializam rotação com Web Locks', async () => {
  let queue = Promise.resolve(), active = 0, peak = 0
  const locks = { request(name, callback) { assert.equal(name, 'sd:refresh-session'); const task = queue.then(callback); queue = task.catch(() => {}); return task } }
  const fetch = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return refreshed() }
  const a = client(fetch, locks), b = client(fetch, locks)
  await Promise.all([a.api.restoreSession(), b.api.restoreSession()])
  assert.equal(peak, 1); assert.equal(a.state.token, 'new'); assert.equal(b.state.token, 'new')
})
test('renovação nunca repete uma operação na identidade de outro usuário', async () => {
  const c = client(async () => Response.json({ accessToken: 'other', user: { id: 'other-user' } }))
  assert.equal(await c.api.restoreSession(), false)
  assert.equal(c.state.token, null)
})
