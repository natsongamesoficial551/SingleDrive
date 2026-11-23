import { app } from './app.js'
import { env } from './config/env.js'

import { startDiscordMemberRoles } from './modules/discord/discord-members.js'

app.listen(env.APP_PORT, env.APP_HOST, () => {
  startDiscordMemberRoles()
  console.log(`Backend listening on ${env.APP_HOST}:${env.APP_PORT}`)
})
