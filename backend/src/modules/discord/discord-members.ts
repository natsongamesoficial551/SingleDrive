import { WebSocket } from 'undici'
import { env } from '../../config/env.js'
import { discordBotRequest, discordRoleSettings, type DiscordMember } from './discord-api.js'

type GatewayPacket = { op: number; s?: number; t?: string; d: unknown }
type GuildMember = DiscordMember & { guild_id: string }

export function startDiscordMemberRoles() {
  const config = discordRoleSettings()
  if (!config || env.DISCORD_AUTO_MEMBER_ROLE !== 'true') return
  const { token, guildId, memberRoleId } = config
  const membersPath = `/guilds/${guildId}/members`
  let reconnectDelay = 5000
  let reconciling = false

  async function grant(member: DiscordMember) {
    if (member.user.bot || member.pending || member.roles.includes(memberRoleId)) return
    const response = await discordBotRequest(token, `${membersPath}/${member.user.id}/roles/${memberRoleId}`, 'PUT')
    if (!response.ok && response.status !== 404) throw new Error('Discord member role request failed')
  }

  async function reconcile() {
    if (reconciling) return
    reconciling = true
    try {
      let cursor = '0'
      for (;;) {
        const response = await discordBotRequest(token, membersPath + '?limit=100&after=' + cursor)
        if (!response.ok) throw new Error('Discord member list unavailable')
        const page = await response.json() as DiscordMember[]
        for (const member of page) await grant(member)
        if (page.length < 100) return
        cursor = page[page.length - 1].user.id
      }
    } finally {
      reconciling = false
    }
  }

  function connect() {
    const socket = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json')
    let lastSequence: number | null = null
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let firstBeat: ReturnType<typeof setTimeout> | undefined
    let acknowledged = true
    const connectTimeout = setTimeout(() => socket.close(), 15_000)
    const send = (op: number, d: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op, d }))
    }
    const beat = () => {
      if (!acknowledged) { socket.close(); return }
      acknowledged = false
      send(1, lastSequence)
    }

    socket.addEventListener('message', event => {
      let packet: GatewayPacket
      try { packet = JSON.parse(String(event.data)) as GatewayPacket } catch { return }
      if (typeof packet.s === 'number') lastSequence = packet.s
      if (packet.op === 10) {
        clearTimeout(connectTimeout)
        const { heartbeat_interval: interval } = packet.d as { heartbeat_interval: number }
        firstBeat = setTimeout(() => {
          beat()
          heartbeat = setInterval(beat, interval)
        }, Math.random() * interval)
        send(2, {
          token, intents: (1 << 0) | (1 << 1),
          properties: { os: process.platform, browser: 'SingleDrive', device: 'SingleDrive' },
        })
      }
      if (packet.op === 11) acknowledged = true
      if (packet.op === 1) send(1, lastSequence)
      if (packet.op === 7 || packet.op === 9) socket.close()
      if (packet.t === 'READY') {
        reconnectDelay = 5000
        void reconcile().catch(() => console.warn('Discord member role reconciliation failed.'))
      }
      if (packet.t === 'GUILD_MEMBER_ADD' || packet.t === 'GUILD_MEMBER_UPDATE') {
        const member = packet.d as GuildMember
        if (member.guild_id === guildId) {
          void grant(member).catch(() => console.warn('Discord member role assignment failed.'))
        }
      }
    })
    socket.addEventListener('close', event => {
      clearTimeout(connectTimeout)
      clearTimeout(firstBeat)
      clearInterval(heartbeat)
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(event.code)) {
        console.warn('Discord member role connection rejected. Check bot configuration and Guild Members intent.')
        return
      }
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000)
    })
  }

  connect()
}
