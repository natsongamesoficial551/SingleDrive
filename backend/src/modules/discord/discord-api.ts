import { setTimeout } from 'node:timers/promises'
import { env } from '../../config/env.js'

const root = 'https://discord.com/api/v10'
export const discordUserAgent = 'DiscordBot (https://singledrive.pages.dev/, 1.0)'
export const snowflake = /^\d{17,20}$/

export function discordRoleSettings() {
  const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId, DISCORD_MEMBER_ROLE_ID: memberRoleId, DISCORD_FOLLOWING_ROLE_ID: followingRoleId } = env
  return token && guildId && memberRoleId && followingRoleId && guildId !== memberRoleId &&
    guildId !== followingRoleId && memberRoleId !== followingRoleId ? { token, guildId, memberRoleId, followingRoleId } : null
}

export async function discordRequest(path: string, init: RequestInit, retry = false) {
  const send = () => {
    const headers = new Headers(init.headers)
    headers.set('User-Agent', discordUserAgent)
    return fetch(root + path, { ...init, headers, signal: AbortSignal.timeout(10_000), redirect: 'error' })
  }
  const response = await send()
  if (!retry || response.status !== 429) return response
  const rawDelay = response.headers.get('Retry-After')
  const delay = rawDelay === null ? NaN : Number(rawDelay)
  await response.body?.cancel()
  if (!Number.isFinite(delay) || delay < 0 || delay > 4) return response
  await setTimeout(delay * 1000 + 100)
  return send()
}

export function discordBotRequest(token: string, path: string, method = 'GET') {
  return discordRequest(path, { method, headers: { Authorization: 'Bot ' + token } }, true)
}

export type DiscordMember = { user: { id: string; bot?: boolean }; roles: string[]; pending?: boolean }
