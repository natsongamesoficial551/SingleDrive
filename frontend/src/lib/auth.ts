export type AuthUser = { id: string; name: string; email: string; status?: string }
let accessToken: string | null = null
const USER_KEY = 'sd:user'
// Apagar credenciais de versões anteriores; o refresh atual é cookie HttpOnly.
for (const key of ['9drive.accessToken', '9drive.refreshToken', '9drive.user']) localStorage.removeItem(key)
export function getAccessToken() { return accessToken }
export function getStoredUser(): AuthUser | null {
  try { const raw = sessionStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) as AuthUser : null } catch { return null }
}
export function setAuthSession(token: string, user: AuthUser) { accessToken = token; updateStoredUser(user) }
export function updateStoredUser(user: AuthUser) { sessionStorage.setItem(USER_KEY, JSON.stringify(user)) }
export function setAccessToken(token: string) { accessToken = token }
export function clearAuthSession() { accessToken = null; sessionStorage.removeItem(USER_KEY) }
