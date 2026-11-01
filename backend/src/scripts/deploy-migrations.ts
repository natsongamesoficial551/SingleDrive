import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** A aplicação mantém o pooler; migrações precisam de conexão direta com sessão estável. */
export function migrationDatabaseUrl(databaseUrl: string, explicitDirectUrl?: string): string {
  if (explicitDirectUrl) return explicitDirectUrl
  const parsed = new URL(databaseUrl)
  if (/^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.aws\.neon\.tech$/i.test(parsed.hostname)) {
    parsed.hostname = parsed.hostname.replace(/-pooler(?=\.)/i, '')
    parsed.searchParams.delete('pgbouncer')
    return parsed.toString()
  }
  return databaseUrl
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL não configurada para a migração.')
    process.exit(1)
  }
  let directUrl: string
  try { directUrl = migrationDatabaseUrl(databaseUrl, process.env.DIRECT_DATABASE_URL) }
  catch { console.error('DATABASE_URL inválida para a migração.'); process.exit(1) }
  console.info('Executando migrações com conexão direta quando disponível; a trava de segurança permanece ativa.')
  const prismaCli = path.resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, DATABASE_URL: directUrl },
  })
  if (result.error) console.error('Não foi possível executar o Prisma:', result.error.message)
  process.exit(result.status ?? 1)
}
