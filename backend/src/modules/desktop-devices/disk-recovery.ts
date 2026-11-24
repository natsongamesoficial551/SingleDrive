import type { Prisma } from '@prisma/client'

export async function previousDisk(db: Prisma.TransactionClient, device: { id: string; userId: string; name: string }) {
  const where = {
    id: { not: device.id }, userId: device.userId,
    remoteDiskAccountId: { not: null }, remoteDiskRootId: { not: null },
  }
  const orderBy = [{ lastSeenAt: 'desc' }, { id: 'asc' }] as const
  const select = { remoteDiskAccountId: true, remoteDiskPoolEnabled: true } as const
  return await db.desktopDevice.findFirst({
    where: { ...where, name: { equals: device.name } }, orderBy: [...orderBy], select,
  }) ?? await db.desktopDevice.findFirst({ where, orderBy: [...orderBy], select })
}
