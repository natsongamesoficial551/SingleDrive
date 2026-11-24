import { app } from './app.js'
import { env } from './config/env.js'

import { startDiscordMemberRoles } from './modules/discord/discord-members.js'
import { startRenderKeepAlive } from './render-keep-alive.js'

app.listen(env.APP_PORT, env.APP_HOST, () => {
  startDiscordMemberRoles()
  startRenderKeepAlive()
  console.log(`Backend listening on ${env.APP_HOST}:${env.APP_PORT}`)
})
