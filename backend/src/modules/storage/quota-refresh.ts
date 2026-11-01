import { prisma } from '../../config/prisma.js'
import { syncGoogleQuota } from '../google/google.service.js'
import { syncS3Quota } from '../s3/s3.service.js'

const refreshing = new Map<string, ReturnType<typeof syncGoogleQuota>>()

export function refreshAccountQuota(account: { id: string; provider: string }) {
  const pending = refreshing.get(account.id)
  if (pending) return pending
  const task = (account.provider === 's3' ? syncS3Quota(account.id) : syncGoogleQuota(account.id))
    .finally(() => { refreshing.delete(account.id) })
  refreshing.set(account.id, task)
  return task
}

export async function refreshStaleQuotas(userId: string) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, status: 'connected' }, include: { storageAccount: true },
  })
  const stale = accounts.filter(account => !account.storageAccount?.lastSyncedAt ||
    (account.provider === 'google_drive' && account.storageAccount.lastSyncedAt.getTime() < Date.now() - 60_000))
  // Limitar concorrência e preservar os últimos valores se uma conta estiver indisponível.
  for (let offset = 0; offset < stale.length; offset += 3) {
    await Promise.allSettled(stale.slice(offset, offset + 3).map(refreshAccountQuota))
  }
}
