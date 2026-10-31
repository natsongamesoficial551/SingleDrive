import { google } from 'googleapis'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { decryptText } from '../utils/crypto.js'
import { createOAuthClient } from '../modules/google/google.service.js'

// Execução administrativa explícita. Sem --apply, apenas consulta permissões.
// Nunca busca arquivos de contas diferentes nem imprime credenciais.
async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--account', '--user', '--apply'].includes(arg) && !z.string().uuid().safeParse(arg).success)) throw new Error('Use --user UUID --account UUID [--apply].')
  const value = (flag: string) => z.string().uuid().parse(args[args.indexOf(flag) + 1])
  if (!args.includes('--account') || !args.includes('--user')) throw new Error('Informe --user UUID --account UUID [--apply].')
  const apply = args.includes('--apply')
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: value('--account'), userId: value('--user'), provider: 'google_drive' }, include: { providerConfig: true } })
  if (!account.providerConfig || !account.refreshTokenEncrypted) throw new Error('Conta sem credenciais Google para auditoria. Reconecte a conta verificada.')
  // A auditoria também precisa atender contas legadas bloqueadas pela migração.
  const auth = createOAuthClient(account.providerConfig)
  auth.setCredentials({ refresh_token: decryptText(account.refreshTokenEncrypted) })
  const drive = google.drive({ version: 'v3', auth })
  const files = await prisma.file.findMany({ where: { userId: account.userId, connectedAccountId: account.id, provider: 'google_drive' }, select: { providerFileId: true } })
  const folders = await prisma.folder.findMany({ where: { userId: account.userId, connectedAccountId: account.id }, select: { providerFolderId: true } })
  const ids = new Set([...files.map(file => file.providerFileId), ...folders.flatMap(folder => folder.providerFolderId ? [folder.providerFolderId] : [])])
  let publicPermissions = 0, removed = 0, failures = 0
  for (const fileId of ids) {
    try {
      let pageToken: string | undefined
      do {
        const result = await drive.permissions.list({ fileId, pageToken, pageSize: 100, fields: 'nextPageToken,permissions(id,type,role,permissionDetails(inherited,inheritedFrom))', supportsAllDrives: true })
        for (const permission of result.data.permissions ?? []) {
          if (permission.type !== 'anyone' || !permission.id) continue
          publicPermissions++
          const inherited = permission.permissionDetails?.some(detail => detail.inherited) ?? false
          console.log(JSON.stringify({ fileId, permissionId: permission.id, role: permission.role, inherited, action: apply ? 'remove' : 'dry-run' }))
          if (apply) {
            await drive.permissions.delete({ fileId, permissionId: permission.id, supportsAllDrives: true })
            removed++
          }
        }
        pageToken = result.data.nextPageToken ?? undefined
      } while (pageToken)
    } catch {
      failures++
      console.error(JSON.stringify({ fileId, error: 'Não foi possível verificar/remover a permissão. Revise acesso, herança e existência do arquivo no Google.' }))
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', checkedFiles: ids.size, publicPermissions, removed, failures,
    limitation: 'Somente arquivos e pastas registrados no banco. Arquivos órfãos, ACLs herdadas e cópias externas exigem revisão adicional no Google Drive.' }))
  if (failures) process.exitCode = 1
}

main().catch(() => { console.error('Auditoria incompleta. Verifique os argumentos, a conexão e as credenciais sem expor segredos.'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
