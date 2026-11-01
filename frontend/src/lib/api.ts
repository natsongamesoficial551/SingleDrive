import { clearAuthSession, getAccessToken, getStoredUser, setAuthSession } from '@/lib/auth'

// Em produção o proxy /api evita cookies de terceiros.
export const API_URL = import.meta.env.PROD ? '/api' : (import.meta.env.VITE_API_URL || 'http://localhost:4000')
type ApiOptions = RequestInit & { skipAuth?: boolean; retry?: boolean }
let restoring: Promise<boolean> | null = null
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function responseError(response: Response) {
  const error = await response.json().catch(() => ({ message: response.statusText }))
  const retryAfter = Number(response.headers.get('Retry-After'))
  const wait = response.status === 429 && retryAfter > 0 ? ` Tente novamente em ${Math.ceil(retryAfter / 60)} minuto(s).` : ''
  return new ApiError((error.message ?? 'Falha ao acessar o servidor.') + wait, response.status)
}

export function restoreSession(): Promise<boolean> {
  if (restoring) return restoring
  const refresh = async () => {
    const previousUser = getStoredUser()
    const response = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (response.status === 401) { clearAuthSession(); return false }
    // Falhas transitórias não revogam a sessão nem apagam o acesso em memória.
    if (!response.ok) throw await responseError(response)
    const data = await response.json()
    if (previousUser && previousUser.id !== data.user.id) { clearAuthSession(); return false }
    setAuthSession(data.accessToken, data.user)
    return true
  }
  // O cookie é compartilhado por abas e popups, mas o Promise acima não é.
  // Serializar evita duas rotações simultâneas do mesmo refresh token.
  restoring = (navigator.locks
    ? navigator.locks.request('sd:refresh-session', refresh)
    : refresh()).finally(() => { restoring = null })
  return restoring
}

export async function apiFetchRaw(path: string, options: ApiOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  const token = getAccessToken()
  if (!options.skipAuth && token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  if (response.status === 401 && options.retry !== false && !options.skipAuth) {
    // Outra requisição pode ter renovado o token enquanto esta estava em trânsito.
    if ((getAccessToken() && getAccessToken() !== token) || await restoreSession()) {
      return apiFetchRaw(path, { ...options, retry: false })
    }
  }

  if (!response.ok) {
    throw await responseError(response)
  }

  return response
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return (await apiFetchRaw(path, options)).json() as Promise<T>
}

export function formatBytes(input: string | number | bigint | null | undefined) {
  if (input === null || input === undefined) return '--'
  const bytes = Number(input)
  if (!Number.isFinite(bytes)) return '--'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
