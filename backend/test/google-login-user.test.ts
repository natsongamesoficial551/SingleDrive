import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import { resolveGoogleLoginUser } from '../src/modules/auth/google-login-user.js'

test('Google login requires an existing account to be explicitly linked', async () => {
  const user = { id: 'existing-user' }
  let linked: { status: string } | null = null
  let created = false
  const db = {
    user: { findUnique: async () => user, create: async () => { created = true; return user } },
    connectedAccount: { findUnique: async () => linked },
  } as unknown as PrismaClient
  const identity = { email: 'owner@example.com', providerAccountId: 'google-id', name: 'Owner', passwordHash: 'hash' }
  assert.equal(await resolveGoogleLoginUser(db, identity), null)
  linked = { status: 'disconnected' }
  assert.equal(await resolveGoogleLoginUser(db, identity), null)
  linked = { status: 'connected' }
  assert.equal(await resolveGoogleLoginUser(db, identity), user)
  assert.equal(created, false)
})

test('Google login creates an account when the email is new', async () => {
  const user = { id: 'new-user' }
  const db = { user: { findUnique: async () => null, create: async () => user } } as unknown as PrismaClient
  assert.equal(await resolveGoogleLoginUser(db, { email: 'new@example.com', providerAccountId: 'google-id', name: 'New', passwordHash: 'hash' }), user)
})
