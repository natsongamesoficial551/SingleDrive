import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { encryptText, decryptText, hashToken } from '../../utils/crypto.js'

export const backupRouter = Router()
backupRouter.use(requireAuth)
export const relativePath = z.string().min(1).max(2048).refine(value => value.split('/').every(part =>
  part.length > 0 && part !== '.' && part !== '..' && !/[\\<>:"|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) &&
  !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'Caminho relativo inválido')
const rootMetadata = z.object({ name: z.string().min(1).max(255), machine: z.string().max(191),
  originalPath: z.string().min(1).max(2048), anchor: z.enum(['Desktop', 'MyDocuments', 'MyPictures', 'MyMusic', 'MyVideos', 'UserProfile', 'Absolute']),
  suffix: z.string().max(2048) })

backupRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const roots = await prisma.backupRoot.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } })
    return res.json({ roots: roots.map(root => ({ id: root.id, ...JSON.parse(decryptText(root.metadata)), updatedAt: root.updatedAt })) })
  } catch (error) { return next(error) }
})
backupRouter.post('/roots', async (req: AuthRequest, res, next) => {
  try {
    const body = rootMetadata.parse(req.body)
    const device = await prisma.desktopDevice.findFirst({ where: { userId: req.user!.id, sessionId: req.user!.sessionId, revokedAt: null } })
    if (!device) return res.status(403).json({ code: 'DEVICE_NOT_LINKED', message: 'Vincule este PC antes de enviar o catálogo.' })
    const rootKey = hashToken(body.originalPath.toLowerCase())
    const root = await prisma.backupRoot.upsert({ where: { userId_deviceId_rootKey: { userId: req.user!.id, deviceId: device.id, rootKey } },
      create: { userId: req.user!.id, deviceId: device.id, rootKey, metadata: encryptText(JSON.stringify(body)) },
      update: { metadata: encryptText(JSON.stringify(body)) } })
    return res.json({ id: root.id })
  } catch (error) { return next(error) }
})
backupRouter.post('/:id/entries', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const body = z.union([
      z.object({ relativePath, kind: z.literal('directory') }),
      z.object({ relativePath, kind: z.literal('empty'), modifiedUtc: z.string().datetime() }),
      z.object({ relativePath, fileId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), modifiedUtc: z.string().datetime() }),
    ]).parse(req.body)
    const root = await prisma.backupRoot.findFirst({ where: { id, userId: req.user!.id } })
    const device = await prisma.desktopDevice.findFirst({ where: { id: root?.deviceId ?? '', sessionId: req.user!.sessionId, revokedAt: null } })
    if (!root || !device) return res.status(404).json({ code: 'BACKUP_NOT_FOUND', message: 'Backup não encontrado neste PC.' })
    const file = 'fileId' in body ? await prisma.file.findFirst({ where: { id: body.fileId, userId: req.user!.id, status: 'active' } }) : null
    if ('fileId' in body && !file) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado.' })
    const metadata = encryptText(JSON.stringify({ ...body, sizeBytes: file?.sizeBytes.toString() ?? '0' }))
    await prisma.backupEntry.upsert({ where: { rootId_pathKey: { rootId: id, pathKey: hashToken(body.relativePath.toLowerCase()) } },
      create: { rootId: id, pathKey: hashToken(body.relativePath.toLowerCase()), fileId: file?.id ?? null, metadata }, update: { fileId: file?.id ?? null, metadata } })
    return res.json({ status: 'ok' })
  } catch (error) { return next(error) }
})
backupRouter.get('/:id/entries', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const after = z.string().uuid().optional().parse(req.query.after)
    if (!await prisma.backupRoot.findFirst({ where: { id, userId: req.user!.id } })) return res.status(404).json({ code: 'BACKUP_NOT_FOUND', message: 'Backup não encontrado.' })
    const rows = await prisma.backupEntry.findMany({ where: { rootId: id, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 500 })
    return res.json({ entries: rows.map(row => JSON.parse(decryptText(row.metadata))), next: rows.length === 500 ? rows.at(-1)!.id : null })
  } catch (error) { return next(error) }
})
