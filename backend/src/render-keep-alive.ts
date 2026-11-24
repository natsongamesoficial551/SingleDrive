const pingIntervalMs = 7 * 60 * 1_000

export function startRenderKeepAlive(): void {
  const { RENDER, RENDER_EXTERNAL_URL, IS_PULL_REQUEST } = process.env
  if (RENDER !== 'true' || !RENDER_EXTERNAL_URL || IS_PULL_REQUEST === 'true') return

  const ping = async (): Promise<void> => {
    try {
      // Use Render's public ingress so the ping reaches the service as inbound traffic.
      const healthUrl = new URL('/health', RENDER_EXTERNAL_URL)
      const response = await fetch(healthUrl, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as { status?: string }
      if (result.status !== 'ok') throw new Error('Unexpected health status')
      console.info('Render keep-alive: /health OK')
    } catch (error) {
      console.warn('Render keep-alive: /health request failed', error)
    }
  }

  void ping()
  setInterval(() => void ping(), pingIntervalMs).unref()
}
