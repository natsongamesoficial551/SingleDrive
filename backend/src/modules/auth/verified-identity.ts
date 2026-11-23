import type { Prisma } from '@prisma/client'

export const enabledIdentity = {
  OR: [
    { googleSubject: { not: null } },
    { emailVerifiedAt: { not: null }, discordLink: { is: { loginEnabledAt: { not: null } } } },
  ],
} satisfies Prisma.UserWhereInput

export const identitySelection = {
  status: true, googleSubject: true, emailVerifiedAt: true,
  discordLink: { select: { loginEnabledAt: true } },
} satisfies Prisma.UserSelect

type Identity = Prisma.UserGetPayload<{ select: typeof identitySelection }>
export function canAuthenticate(user: Identity) {
  return user.status === 'active' && !!(user.googleSubject || (user.emailVerifiedAt && user.discordLink?.loginEnabledAt))
}
