import { Router } from 'express'
import { z } from 'zod'
import type { DesktopDevice } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'

export const desktopDeviceRouter = Router()
desktopDeviceRouter.use(requireAuth)

function serialize(device: DesktopDevice, session: { revokedAt: Date | null; expiresAt: Date }) {
  const revoked = !!device.revokedAt || !!session.revokedAt || session.expiresAt <= new Date()
  return {
    id: device.id, name: device.name, platform: device.platform, appVersion: device.appVersion,
    backupEnabled: device.backupEnabled, runtimeStatus: device.runtimeStatus,
    sourceNames: device.sourceNames, uploadedFiles: device.uploadedFiles,
    lastSeenAt: device.lastSeenAt, lastBackupAt: device.lastBackupAt, createdAt: device.createdAt,
    revoked, online: !revoked && Date.now() - device.lastSeenAt.getTime() < 90_000,
  }
}

desktopDeviceRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const devices = await prisma.desktopDevice.findMany({
      where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { session: { select: { revokedAt: true, expiresAt: true } } },
    })
    return res.json({ devices: devices.map(device => serialize(device, device.session)) })
  } catch (error) { return next(error) }
})

desktopDeviceRouter.post('/register', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(191), platform: z.literal('windows'), appVersion: z.string().min(1).max(32) }).parse(req.body)
    const session = await prisma.userSession.findUniqueOrThrow({ where: { id: req.user!.sessionId } })
    // Uma sess√£o de site/APK n√£o se transforma implicitamente em credencial do PC.
    if (session.client !== 'desktop') return res.status(403).json({ code: 'DESKTOP_SESSION_REQUIRED', message: 'Entre com Google pelo aplicativo Windows para vincular este PC.' })
    const device = await prisma.$transaction(async tx => {
      // O UPDATE trava a linha do usu·rio atÈ o commit, serializando vÌnculos concorrentes.
      await tx.user.update({ where: { id: req.user!.id }, data: { updatedAt: new Date() } })
      const existing = await tx.desktopDevice.findUnique({ where: { sessionId: session.id } })
      if (existing?.revokedAt) return null
      if (!existing && await tx.desktopDevice.count({ where: { userId: req.user!.id, revokedAt: null,
        session: { revokedAt: null, expiresAt: { gt: new Date() } } } }) >= 5) return null
      return tx.desktopDevice.upsert({
        where: { sessionId: session.id },
        create: { ...body, userId: req.user!.id, sessionId: session.id, sourceNames: [] },
        update: { ...body, lastSeenAt: new Date() },
      })
    }, { isolationLevel: 'ReadCommitted' })
    if (!device) return res.status(409).json({ code: 'DEVICE_LIMIT_REACHED', message: 'Sua conta permite atÈ 5 computadores. Revogue um vÌnculo antigo na p·gina Computadores e tente novamente.' })
    return res.json({ device: serialize(device, session) })
  } catch (error) { return next(error) }
})

desktopDeviceRouter.post('/heartbeat', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      runtimeStatus: z.enum(['idle', 'paused', 'scanning', 'uploading', 'error']),
      sourceNames: z.array(z.string().trim().min(1).max(255)).max(20),
      uploadedFiles: z.number().int().min(0).max(2_147_483_647),
      completedScan: z.boolean().default(false),
    }).parse(req.body)
    const { completedScan, ...data } = body
    const changed = await prisma.desktopDevice.updateMany({
      where: { sessionId: req.user!.sessionId, userId: req.user!.id, revokedAt: null },
      data: { ...data, lastSeenAt: new Date(), ...(completedScan ? { lastBackupAt: new Date() } : {}) },
    })
    if (changed.count !== 1) return res.status(403).json({ code: 'DEVICE_NOT_LINKED', message: 'Vincule este PC novamente.' })
    const device = await prisma.desktopDevice.findUniqueOrThrow({ where: { sessionId: req.user!.sessionId } })
    return res.json({ backupEnabled: device.backupEnabled })
  } catch (error) { return next(error) }
})

desktopDeviceRouter.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const body = z.object({ backupEnabled: z.boolean() }).parse(req.body)
    const result = await prisma.desktopDevice.updateMany({
      where: { id, userId: req.user!.id, revokedAt: null, session: { revokedAt: null, expiresAt: { gt: new Date() } } }, data: body,
    })
    if (!result.count) return res.status(404).json({ code: 'DEVICE_NOT_FOUND', message: 'Computador n√£o encontrado ou v√≠nculo expirado.' })
    return res.json({ status: 'ok' })
  } catch (error) { return next(error) }
})

desktopDeviceRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    // Revogar a sess√£o bloqueia tamb√©m uploads e renova√ß√£o de token do agente.
    const found = await prisma.$transaction(async tx => {
      const device = await tx.desktopDevice.findFirst({ where: { id, userId: req.user!.id } })
      if (!device) return false
      const revokedAt = new Date()
      await tx.desktopDevice.update({ where: { id }, data: { revokedAt, backupEnabled: false, runtimeStatus: 'paused' } })
      await tx.userSession.updateMany({ where: { id: device.sessionId, userId: req.user!.id }, data: { revokedAt } })
      return true
    })
    if (!found) return res.status(404).json({ code: 'DEVICE_NOT_FOUND', message: 'Computador n√£o encontrado.' })
    return res.json({ status: 'ok' })
  } catch (error) { return next(error) }
})
