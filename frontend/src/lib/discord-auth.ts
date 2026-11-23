import { apiFetch } from '@/lib/api'

export type DiscordFlow = 'login' | 'access' | 'community'
const prefix = 'sd:discord-flow:'

export async function startDiscordFlow(flow: DiscordFlow) {
  const route = flow === 'community' ? '/auth/discord/start' : `/auth/discord/${flow}/start`
  const { state, url } = await apiFetch<{ state: string; url: string }>(route, {
    method: 'POST', skipAuth: flow === 'login', retry: false,
  })
  sessionStorage.setItem(prefix + state, JSON.stringify({ flow, expiresAt: Date.now() + 10 * 60_000 }))
  window.location.assign(url)
}

export function consumeDiscordFlow(state: string | null): DiscordFlow {
  if (!state) return 'community'
  const key = prefix + state
  const data = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  if (data) {
    try {
      const { flow, expiresAt } = JSON.parse(data)
      if (expiresAt > Date.now() && (flow === 'login' || flow === 'access')) return flow
    } catch { /* Treat corrupted storage as an unknown authorization. */ }
  }
  // Complete logins that were started by the previous site release.
  const oldKey = 'sd:discord-login:' + state
  const oldExpiry = sessionStorage.getItem(oldKey)
  sessionStorage.removeItem(oldKey)
  return Number(oldExpiry) > Date.now() ? 'login' : 'community'
}
