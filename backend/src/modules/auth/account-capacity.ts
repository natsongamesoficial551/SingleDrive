import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'

const maxProfiles = 100
const maxStorageAccounts = 100
export const maxDesktopDevices = 10

export class AccountCapacityError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export async function registerGoogleProfile(identity: { email: string; name: string; googleSubject: string }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const existing = await tx.user.findUnique({ where: { googleSubject: identity.googleSubject } })
        if (existing) return existing
        if (await tx.user.findUnique({ where: { email: identity.email }, select: { id: true } })) {
          throw new AccountCapacityError('GOOGLE_IDENTITY_CONFLICT', 'Esta conta exige recuperação da identidade original.')
        }
        if (await tx.user.count() >= maxProfiles) {
          throw new AccountCapacityError('ACCOUNT_LIMIT_REACHED', 'O SingleDrive atingiu o limite de 100 contas.')
        }
        return tx.user.create({
          data: { ...identity, emailVerifiedAt: new Date(), passwordHash: 'disabled:google' },
        })
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError)
        || (error.code !== 'P2034' && error.code !== 'P2002')) throw error
    }
  }
  throw new Error('Não foi possível reservar uma vaga para a conta.')
}

// Google e S3 reservam vagas sob o mesmo lock. Reconectar uma conta ativa não ocupa outra vaga.
export async function reserveStorageAccount(tx: Prisma.TransactionClient, userId: string, provider: string, providerAccountId: string) {
  await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() }, select: { id: true } })
  const existing = await tx.connectedAccount.findUnique({
    where: { userId_provider_providerAccountId: { userId, provider, providerAccountId } },
  })
  if (existing?.status !== 'connected' && await tx.connectedAccount.count({ where: { userId, status: 'connected' } }) >= maxStorageAccounts) {
    throw new AccountCapacityError('STORAGE_ACCOUNT_LIMIT_REACHED', 'Cada perfil pode manter até 100 contas de armazenamento conectadas.')
  }
  return existing
}
