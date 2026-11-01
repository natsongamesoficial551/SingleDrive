import { test } from 'node:test'
import assert from 'node:assert/strict'
import keepApiWarm, { config } from '../functions/keep-api-warm.mjs'

test('ping usa somente o destino fixo, sem credenciais, e valida saúde', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://singledrive.onrender.com/health')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.body, undefined)
    assert.ok(options.signal instanceof AbortSignal)
    return Response.json({ status: 'ok' })
  })
  assert.equal(config.schedule, '*/5 * * * *')
  assert.equal((await keepApiWarm()).status, 204)
})

test('HTML de inicialização, erro HTTP e falha de rede não viram sucesso', async t => {
  const mock = t.mock.method(globalThis, 'fetch')
  for (const response of [new Response('<html>Iniciando</html>'), new Response(null, { status: 503 }), Response.json({ status: 'failed' })]) {
    mock.mock.mockImplementation(async () => response)
    await assert.rejects(keepApiWarm())
  }
  mock.mock.mockImplementation(async () => { throw new Error('timeout') })
  await assert.rejects(keepApiWarm(), /timeout/)
})
