import { app } from './app.js'
import { env } from './config/env.js'

app.listen(env.APP_PORT, env.APP_HOST, () => {
  console.log(`Backend listening on ${env.APP_HOST}:${env.APP_PORT}`)
})
