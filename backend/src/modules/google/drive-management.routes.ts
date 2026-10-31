import { Router } from 'express'
import { google } from 'googleapis'
import { Transform } from 'node:stream'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import type { AuthRequest } from '../../middleware/auth.middleware.js'
import { getAuthedGoogleClient } from './google.service.js'

export const driveManagementRouter = Router({ mergeParams: true })
const nameSchema = z.string().trim().min(1).max(255)
const idSchema = z.string().min(1).max(200)

async function accountDrive(req: AuthRequest) {
  const account = await prisma.connectedAccount.findFirstOrThrow({
    where: { id: String(req.params.id), userId: req.user!.id, provider: 'google_drive', status: 'connected' },
  })
  return google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
}

// O SingleDrive mantém registros próprios para a pasta 9drive; não os remova por fora dessa biblioteca.
async function isManagedFolderItem(drive: ReturnType<typeof google.drive>, fileId: string) {
  const roots = await drive.files.list({ q: "name = '9drive' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false", fields: 'files(id)', pageSize: 100 })
  const rootIds = new Set((roots.data.files ?? []).map((file) => file.id))
  let current: string | undefined = fileId
  const visited = new Set<string>()
  while (current && !visited.has(current)) {
    if (rootIds.has(current)) return true
    visited.add(current)
    const metadata: { data: { parents?: string[] | null } } = await drive.files.get({ fileId: current, fields: 'parents', supportsAllDrives: true })
    current = metadata.data.parents?.[0]
  }
  return false
}

driveManagementRouter.patch('/items/:fileId', async (req: AuthRequest, res, next) => {
  try {
    const fileId = idSchema.parse(req.params.fileId)
    const name = nameSchema.parse(req.body.name)
    const drive = await accountDrive(req)
    if (await isManagedFolderItem(drive, fileId)) return res.status(409).json({ message: 'Para manter a biblioteca sincronizada, renomeie este item pela área Meus arquivos do SingleDrive.' })
    const file = await drive.files.update({ fileId, requestBody: { name }, fields: 'id,name', supportsAllDrives: true })
    await prisma.file.updateMany({ where: { userId: req.user!.id, connectedAccountId: String(req.params.id), providerFileId: fileId }, data: { name } })
    return res.json(file.data)
  } catch (error) { return next(error) }
})

driveManagementRouter.post('/items/:fileId/trash', async (req: AuthRequest, res, next) => {
  try {
    const fileId = idSchema.parse(req.params.fileId)
    const drive = await accountDrive(req)
    if (await isManagedFolderItem(drive, fileId)) return res.status(409).json({ message: 'Para manter a biblioteca sincronizada, remova este item pela área Meus arquivos do SingleDrive.' })
    await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true })
    return res.json({ status: 'ok' })
  } catch (error) { return next(error) }
})

driveManagementRouter.post('/folders', async (req: AuthRequest, res, next) => {
  try {
    const { name, parentId } = z.object({ name: nameSchema, parentId: idSchema }).parse(req.body)
    const drive = await accountDrive(req)
    const result = await drive.files.create({ requestBody: { name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }, fields: 'id,name', supportsAllDrives: true })
    return res.status(201).json(result.data)
  } catch (error) { return next(error) }
})

driveManagementRouter.post('/upload', async (req: AuthRequest, res, next) => {
  try {
    const { name, parentId, mimeType } = z.object({ name: nameSchema, parentId: idSchema, mimeType: z.string().max(255).default('application/octet-stream') }).parse(req.query)
    const size = Number(req.get('content-length'))
    if (Number.isFinite(size) && size > env.MAX_UPLOAD_BYTES) return res.status(413).json({ message: 'Arquivo acima do limite permitido.' })
    const drive = await accountDrive(req)
    let bytes = 0
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      callback(bytes > env.MAX_UPLOAD_BYTES ? new Error('Arquivo acima do limite permitido.') : null, chunk)
    } })
    req.on('error', (error) => limiter.destroy(error))
    req.pipe(limiter)
    const result = await drive.files.create({ requestBody: { name, parents: [parentId] }, media: { mimeType, body: limiter }, fields: 'id,name', supportsAllDrives: true })
    return res.status(201).json(result.data)
  } catch (error) { return next(error) }
})

driveManagementRouter.get('/items/:fileId/download', async (req: AuthRequest, res, next) => {
  try {
    const fileId = idSchema.parse(req.params.fileId)
    const drive = await accountDrive(req)
    const metadata = (await drive.files.get({ fileId, fields: 'name,mimeType,capabilities(canDownload)', supportsAllDrives: true })).data
    if (metadata.capabilities?.canDownload === false) return res.status(403).json({ message: 'Esta conta não tem permissão para baixar este arquivo.' })
    const exports: Record<string, [string, string]> = {
      'application/vnd.google-apps.document': ['application/pdf', '.pdf'],
      'application/vnd.google-apps.spreadsheet': ['application/pdf', '.pdf'],
      'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'],
      'application/vnd.google-apps.drawing': ['application/pdf', '.pdf'],
    }
    const exportType = exports[metadata.mimeType ?? '']
    if (metadata.mimeType?.startsWith('application/vnd.google-apps.') && !exportType) return res.status(400).json({ message: 'Este tipo de arquivo do Google não pode ser baixado aqui.' })
    const response = exportType
      ? await drive.files.export({ fileId, mimeType: exportType[0] }, { responseType: 'stream' })
      : await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' })
    const filename = `${metadata.name ?? 'arquivo'}${exportType?.[1] ?? ''}`
    res.setHeader('Content-Type', exportType?.[0] ?? 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()]/g, escape)}`)
    response.data.on('error', (error) => res.destroy(error))
    return response.data.pipe(res)
  } catch (error) { return next(error) }
})
