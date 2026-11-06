export type OAuthFlow = 'login' | 'connect'
export function persistedOAuthFlow(flow: OAuthFlow, client: 'web' | 'android') {
  return client === 'android' ? `android_${flow}` : flow
}
export function normalizeOAuthFlow(flow: string): OAuthFlow | null {
  if (flow === 'login' || flow === 'android_login') return 'login'
  if (flow === 'connect' || flow === 'android_connect') return 'connect'
  return null
}
export function oauthReturnTarget(flow: string, frontendUrl: string) {
  // Fixed callback, never a user-supplied redirect URI. PKCE binds redemption to the initiating app.
  return flow === 'android_login' || flow === 'android_connect'
    ? 'app.singledrive.android://oauth'
    : `${frontendUrl}/google-auth`
}
