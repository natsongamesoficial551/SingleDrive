// Destino fixo: nenhuma URL, credencial ou dado de usuário vem da requisição.
export default async function keepApiWarm() {
  const started = Date.now()
  try {
    const response = await fetch('https://singledrive.onrender.com/health', {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = await response.json()
    if (result.status !== 'ok') throw new Error('Resposta de saúde inesperada')
    console.info(JSON.stringify({ event: 'api-warm', ok: true, elapsedMs: Date.now() - started }))
    return new Response(null, { status: 204 })
  } catch (error) {
    // A primeira chamada já acorda o Render; a próxima execução verifica a retomada.
    console.error(JSON.stringify({ event: 'api-warm', ok: false, elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : 'Falha de conexão' }))
    throw error
  }
}

export const config = { schedule: '*/5 * * * *' }
