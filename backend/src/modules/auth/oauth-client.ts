export type OAuthFlow = 'login' | 'connect'
export function persistedOAuthFlow(flow: OAuthFlow, client: 'web' | 'android' | 'desktop') {
  return client === 'web' ? flow : `${client}_${flow}`
}
export function normalizeOAuthFlow(flow: string): OAuthFlow | null {
  if (flow === 'login' || flow === 'android_login' || flow === 'desktop_login') return 'login'
  if (flow === 'connect' || flow === 'android_connect' || flow === 'desktop_connect') return 'connect'
  return null
}
export function oauthReturnTarget(flow: string, frontendUrl: string) {
  // Fixed callback, never a user-supplied redirect URI. PKCE binds redemption to the initiating app.
  return flow === 'android_login' || flow === 'android_connect'
    ? 'app.singledrive.android://oauth'
    : flow === 'desktop_login' || flow === 'desktop_connect'
    ? 'singledrive-desktop://oauth'
    : `${frontendUrl}/google-auth`
}
