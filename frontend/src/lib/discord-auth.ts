import { apiFetch } from '@/lib/api'

const prefix = 'sd:discord-login:'

export async function startDiscordLogin() {
  const { state, url } = await apiFetch<{ state: string; url: string }>('/auth/discord/login/start', {
    method: 'POST', skipAuth: true, retry: false,
  })
  sessionStorage.setItem(prefix + state, String(Date.now() + 10 * 60_000))
  window.location.assign(url)
}

export function consumeDiscordLogin(state: string | null) {
  if (!state) return false
  const key = prefix + state
  const expires = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  return expires !== null && Number(expires) > Date.now()
}
