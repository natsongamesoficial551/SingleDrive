import { Router } from 'express'
import { google } from 'googleapis'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { decryptText, encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { hashPassword } from '../../utils/password.js'
import { createOAuthClient, getAuthedGoogleClient, syncGoogleQuota } from '../google/google.service.js'
import { syncS3Quota, testS3Connection } from '../s3/s3.service.js'

import { googleCallback } from '../auth/oauth.service.js'

import { parseGoogleBrowseQuery } from '../google/browse-query.js'
import { driveManagementRouter } from '../google/drive-management.routes.js'

export const connectedAccountRouter = Router()
connectedAccountRouter.use('/:id/drive', requireAuth, driveManagementRouter)

const s3ConnectSchema = z.object({
  name: z.string().trim().min(1).max(191),
  bucket: z.string().trim().min(1).max(191),
  region: z.string().trim().min(1).max(191),
  endpoint: z.string().url().optional().or(z.literal('')),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().optional(),
  quotaBytes: z.string().regex(/^\d+$/).optional().nullable(),
})

async function syncQuotaForAccount(account: { id: string; provider: string }) {
  if (account.provider === 's3') return syncS3Quota(account.id)
  return syncGoogleQuota(account.id)
}

connectedAccountRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: req.user!.id, status: 'connected' },
      include: { storageAccount: true },
      orderBy: { createdAt: 'desc' },
    })
    const missingQuota = accounts.filter((account) => !account.storageAccount?.lastSyncedAt)
    for (const account of missingQuota) await syncQuotaForAccount(account).catch(() => undefined)

    const syncedAccounts = missingQuota.length > 0
      ? await prisma.connectedAccount.findMany({
        where: { userId: req.user!.id, status: 'connected' },
        include: { storageAccount: true },
        orderBy: { createdAt: 'desc' },
      })
      : accounts

    return res.json({
      accounts: syncedAccounts.map(({ accessTokenEncrypted: _a, refreshTokenEncrypted: _r, storageAccount, ...account }) => ({
        ...account,
        storageAccount: storageAccount ? {
          ...storageAccount,
          totalBytes: storageAccount.totalBytes?.toString() ?? null,
          usedBytes: storageAccount.usedBytes.toString(),
          availableBytes: storageAccount.availableBytes?.toString() ?? null,
          trashBytes: storageAccount.trashBytes?.toString() ?? null,
        } : null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.post('/s3', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = s3ConnectSchema.parse(req.body)
    if (body.endpoint) return res.status(400).json({ code: 'S3_ENDPOINT_DISABLED', message: 'Custom S3 endpoints are disabled for security.' })
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(body.region)) return res.status(400).json({ code: 'S3_REGION_INVALID', message: 'Invalid S3 region.' })
    const providerConfig = await prisma.providerConfig.findFirstOrThrow({ where: { userId: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
    const providerAccountId = `${body.bucket}:${body.endpoint || body.region}`
    const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: req.user!.id, provider: 's3', providerAccountId } } })
    const account = existingAccount
      ? await prisma.connectedAccount.update({
        where: { id: existingAccount.id },
        data: {
          providerConfigId: providerConfig.id,
          email: `${body.bucket} (S3)`,
          displayName: body.name,
          accessTokenEncrypted: encryptText('s3'),
          refreshTokenEncrypted: encryptText(randomToken()),
          tokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
          scopes: [],
          status: 'connected',
        },
      })
      : await prisma.connectedAccount.create({ data: {
        userId: req.user!.id,
        providerConfigId: providerConfig.id,
        provider: 's3',
        providerAccountId,
        email: `${body.bucket} (S3)`,
        displayName: body.name,
        accessTokenEncrypted: encryptText('s3'),
        refreshTokenEncrypted: encryptText(randomToken()),
        tokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        scopes: [],
        status: 'connected',
      } })
    const config = await prisma.s3StorageConfig.upsert({
      where: { connectedAccountId: account.id },
      create: {
        userId: req.user!.id,
        connectedAccountId: account.id,
        name: body.name,
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint || null,
        accessKeyIdEncrypted: encryptText(body.accessKeyId),
        secretAccessKeyEncrypted: encryptText(body.secretAccessKey),
        forcePathStyle: body.forcePathStyle ?? Boolean(body.endpoint),
        quotaBytes: body.quotaBytes ? BigInt(body.quotaBytes) : null,
      },
      update: {
        name: body.name,
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint || null,
        accessKeyIdEncrypted: encryptText(body.accessKeyId),
        secretAccessKeyEncrypted: encryptText(body.secretAccessKey),
        forcePathStyle: body.forcePathStyle ?? Boolean(body.endpoint),
        quotaBytes: body.quotaBytes ? BigInt(body.quotaBytes) : null,
        status: 'active',
      },
    })
    try {
      await testS3Connection(config)
      const quota = await syncS3Quota(account.id)
      return res.status(201).json({
        account: {
          id: account.id, provider: account.provider, email: account.email, displayName: account.displayName, status: account.status,
          storageAccount: { ...quota, totalBytes: quota.totalBytes?.toString() ?? null, usedBytes: quota.usedBytes.toString(), availableBytes: quota.availableBytes?.toString() ?? null, trashBytes: quota.trashBytes?.toString() ?? null },
        },
      })
    } catch (error) {
      if (!existingAccount) await prisma.connectedAccount.delete({ where: { id: account.id } }).catch(() => undefined)
      throw error
    }
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.get('/google/callback', googleCallback)

connectedAccountRouter.get('/:id/browse', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const query = parseGoogleBrowseQuery(req.query)
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: String(req.params.id), userId: req.user!.id, provider: 'google_drive', status: 'connected' },
    })
    const auth = await getAuthedGoogleClient(account)
    const drive = google.drive({ version: 'v3', auth })
    const response = await drive.files.list({
      q: query.driveQuery,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,capabilities(canEdit,canRename,canTrash,canDownload,canAddChildren))',
      pageSize: 100,
      pageToken: query.pageToken,
      orderBy: 'folder,name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    return res.json({ items: response.data.files ?? [], nextPageToken: response.data.nextPageToken ?? null })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.post('/:id/sync-quota', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId: req.user!.id } })
    const quota = await syncQuotaForAccount(account)
    return res.json({
      quota: {
        ...quota,
        totalBytes: quota.totalBytes?.toString() ?? null,
        usedBytes: quota.usedBytes.toString(),
        availableBytes: quota.availableBytes?.toString() ?? null,
        trashBytes: quota.trashBytes?.toString() ?? null,
      },
    })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId: req.user!.id } })
    if (account.provider === 'google_drive' && account.providerConfigId && account.refreshTokenEncrypted) {
      const config = await prisma.providerConfig.findUniqueOrThrow({ where: { id: account.providerConfigId } })
      await createOAuthClient(config).revokeToken(decryptText(account.refreshTokenEncrypted))
    }
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { status: 'disconnected', accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null } })
    if (account.provider === 's3') await prisma.s3StorageConfig.deleteMany({ where: { connectedAccountId: account.id, userId: req.user!.id } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})
