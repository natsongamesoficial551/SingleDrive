import { apiFetch } from '@/lib/api'

type Pending = { verifier: string; flow: 'login' | 'connect'; expiresAt: number }
const prefix = 'sd:oauth:'
export type GoogleAccessMode = 'essential' | 'full'
export async function startGoogleAuth(flow: 'login' | 'connect', target: Window = window, accessMode: GoogleAccessMode = 'essential') {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const codeChallenge = btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const data = await apiFetch<{ url: string; state: string }>(flow === 'login' ? '/auth/google/start' : '/auth/google/connect', {
    method: 'POST', skipAuth: flow === 'login', body: JSON.stringify({ codeChallenge, accessMode }),
  })
  // Para popup, gravar no próprio contexto; sessionStorage não sincroniza abas.
  target.sessionStorage.setItem(prefix + data.state, JSON.stringify({ verifier, flow, expiresAt: Date.now() + 10 * 60_000 } satisfies Pending))
  target.location.assign(data.url)
}

export function consumeGoogleFlow(state: string): Pending {
  const raw = sessionStorage.getItem(prefix + state)
  sessionStorage.removeItem(prefix + state)
  if (!raw) throw new Error('A autorização deve terminar no navegador em que foi iniciada.')
  const pending = JSON.parse(raw) as Pending
  if (pending.expiresAt <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier)) throw new Error('A autorização expirou. Tente novamente.')
  return pending
}
