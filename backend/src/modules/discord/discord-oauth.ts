import { env } from '../../config/env.js'
import { discordRequest, snowflake } from './discord-api.js'

export function discordOAuthSettings() {
  const { DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: clientSecret } = env
  return clientId && clientSecret ? { clientId, clientSecret } : null
}
type OAuthSettings = NonNullable<ReturnType<typeof discordOAuthSettings>>
const callback = () => new URL('/discord/callback', env.FRONTEND_URL).href

export function discordAuthorizationUrl(config: OAuthSettings, state: string, challenge: string, scope = 'identify') {
  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, scope, redirect_uri: callback(), state,
    code_challenge: challenge, code_challenge_method: 'S256',
  }).toString()
  return url.href
}

export async function discordProfile(config: OAuthSettings, code: string, verifier: string) {
  const tokenResponse = await discordRequest('/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: callback(), code, code_verifier: verifier,
    }),
  })
  if (!tokenResponse.ok) throw new Error('Discord token exchange failed')
  const result = await tokenResponse.json() as { access_token?: string }
  if (!result.access_token) throw new Error('Missing Discord access token')
  const identity = await discordRequest('/users/@me', { headers: { Authorization: 'Bearer ' + result.access_token } })
  if (!identity.ok) throw new Error('Discord identity failed')
  const profile = await identity.json() as { id?: string; bot?: boolean; verified?: boolean; email?: string; global_name?: string; username?: string }
  if (!profile.id || !snowflake.test(profile.id) || profile.bot) throw new Error('Invalid Discord identity')
  return { ...profile, id: profile.id }
}

export async function discordIdentity(config: OAuthSettings, code: string, verifier: string) {
  return (await discordProfile(config, code, verifier)).id
}
