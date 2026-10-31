import type { PrismaClient, User } from '@prisma/client'

type GoogleIdentity = { email: string; providerAccountId: string; name: string; passwordHash: string }

export async function resolveGoogleLoginUser(db: PrismaClient, identity: GoogleIdentity): Promise<User | null> {
  const matchedUser = await db.user.findUnique({ where: { email: identity.email } })
  if (matchedUser) {
    const linkedAccount = await db.connectedAccount.findUnique({
      where: { userId_provider_providerAccountId: { userId: matchedUser.id, provider: 'google_drive', providerAccountId: identity.providerAccountId } },
    })
    return linkedAccount?.status === 'connected' ? matchedUser : null
  }
  return db.user.create({ data: { email: identity.email, name: identity.name, passwordHash: identity.passwordHash } })
}
