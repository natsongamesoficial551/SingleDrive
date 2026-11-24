import { createHash, randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { google } from 'googleapis'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetch as streamFetch } from 'undici'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { diskLimit } from '../../middleware/request-limits.js'
import { getAuthedGoogleClient } from '../google/google.service.js'
import { googleQuotaMaxAgeMs, refreshAccountQuota } from '../storage/quota-refresh.js'
import { DavError, ensureRoot, findRoot, folderMime, nameKey, RemoteDiskTree, rootName, windowsName,
  type DiskCopy, type DiskFile } from './remote-disk-tree.js'
import { previousDisk } from './disk-recovery.js'
import { maxDriveFileBytes, saveDriveStream, sendDrivePart, startDriveUpload } from './drive-stream-upload.js'
import { openPublicDownload, publicDownloadUrl } from './public-download.js'

export const remoteDiskSettingsRouter = Router()
export const remoteDiskDavRouter = Router()
remoteDiskSettingsRouter.use(requireAuth)

const davPrefix = '/remote-disk/dav'
const remoteFileLimit = Math.min(env.MAX_REMOTE_DISK_FILE_BYTES, maxDriveFileBytes)
const methods = 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, COPY, MOVE, DELETE'
const activeSession = () => ({ revokedAt: null, expiresAt: { gt: new Date() } })
const keyHash = (key: string) => createHash('sha256').update(key).digest('hex')
const diskAccounts = (userId: string) => ({ userId, provider: 'google_drive' as const, status: 'connected' as const })
const diskAccount = (id: string, userId: string) => ({ id, ...diskAccounts(userId) })

async function treeFor(device: { userId: string; remoteDiskPoolEnabled: boolean; remoteDiskAccountId: string; remoteDiskRootId: string }) {
  const accounts = await prisma.connectedAccount.findMany({
    where: device.remoteDiskPoolEnabled ? diskAccounts(device.userId) : diskAccount(device.remoteDiskAccountId, device.userId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (!accounts.length) throw new DavError(403, 'Conecte uma conta Google Drive para acessar o disco remoto.')
  return new RemoteDiskTree(accounts, device.userId, device.remoteDiskAccountId, device.remoteDiskRootId)
}

remoteDiskSettingsRouter.put('/devices/:id', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { enabled, accountId, poolEnabled } = z.object({
      enabled: z.boolean(), accountId: z.string().uuid().optional(), poolEnabled: z.boolean().optional(),
    }).parse(req.body)
    const userId = req.user!.id
    const session = await prisma.userSession.findUniqueOrThrow({ where: { id: req.user!.sessionId }, select: { client: true } })
    const fromPc = session.client === 'desktop'
    if (session.client !== 'web' && !fromPc) return res.status(403).json({ message: 'Use o site ou o aplicativo Windows para configurar o disco.' })
    const where = { id, userId, revokedAt: null, session: activeSession(), ...(fromPc ? { sessionId: req.user!.sessionId } : {}) }
    const result = await prisma.$transaction(async tx => {
      // Serializa alterações de política e criação da raiz entre PCs da mesma conta.
      await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() } })
      const device = await tx.desktopDevice.findFirst({ where })
      if (!device) return { status: 404, message: 'Computador não encontrado ou vínculo expirado.' }
      if (fromPc && (!enabled || (device.remoteDiskRootId && !device.remoteDiskEnabled))) {
        throw new DavError(403, 'O acesso a um disco já configurado é controlado na tela Computadores do site.')
      }
      if (!enabled) {
        await tx.desktopDevice.updateMany({ where, data: { remoteDiskEnabled: false, remoteDiskMounted: false,
          ...(device.remoteDiskRootId && poolEnabled !== undefined ? { remoteDiskPoolEnabled: poolEnabled } : {}) } })
        return { status: 200 }
      }
      if (device.remoteDiskAccountId && accountId && accountId !== device.remoteDiskAccountId) {
        throw new DavError(409, 'O disco já tem uma conta Google vinculada. Use a conta original para preservar a fila de arquivos do PC.')
      }
      const previous = !device.remoteDiskRootId && !accountId ? await previousDisk(tx, device) : null
      const pooled = previous?.remoteDiskPoolEnabled ?? poolEnabled ?? device.remoteDiskPoolEnabled
      const previousAccount = previous?.remoteDiskAccountId
      const original = previousAccount && await tx.connectedAccount.findFirst({ where: diskAccount(previousAccount, userId) })
      if (previousAccount && !original && !pooled) {
        throw new DavError(409, 'Reconecte a conta Google Drive original para recuperar as pastas do disco.')
      }
      const selected = device.remoteDiskAccountId ?? accountId ?? (original || undefined)?.id ?? (pooled ? (await tx.connectedAccount.findFirst({
        where: diskAccounts(userId), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
      }))?.id : undefined)
      if (!selected) throw new DavError(400, 'Selecione a conta Google Drive que vai guardar os arquivos.')
      if (device.remoteDiskRootId) {
        const available = await tx.connectedAccount.findFirst({ where: pooled ? diskAccounts(userId) : diskAccount(selected, userId) })
        if (!available) throw new DavError(404, 'Conecte uma conta Google Drive ao SingleDrive.')
        await tx.desktopDevice.updateMany({ where, data: { remoteDiskEnabled: true, remoteDiskPoolEnabled: pooled } })
        return { status: 200 }
      }
      let account = await tx.connectedAccount.findFirst({ where: diskAccount(selected, userId) })
      if (!account) throw new DavError(404, 'A conta Google Drive precisa estar conectada ao SingleDrive.')
      const createDrive = async (candidate: NonNullable<typeof account>) =>
        google.drive({ version: 'v3', auth: await getAuthedGoogleClient(candidate) })
      const drive = await createDrive(account)
      let rootId = previous ? await findRoot(drive, userId) : await ensureRoot(drive, userId)
      if (previous && pooled && !rootId) {
        const candidates = await tx.connectedAccount.findMany({ where: { ...diskAccounts(userId), id: { not: account.id } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
        const roots = await Promise.allSettled(candidates.map(async candidate => ({
          account: candidate, root: await findRoot(await createDrive(candidate), userId),
        })))
        const existing = roots.find(result => result.status === 'fulfilled' && result.value.root)
        if (existing?.status === 'fulfilled') ({ account, root: rootId } = existing.value)
      }
      if (!rootId) throw new DavError(409, 'A pasta do disco anterior está indisponível. Confira as contas conectadas e a lixeira do Google Drive.')
      const update = await tx.desktopDevice.updateMany({
        where, data: { remoteDiskEnabled: true, remoteDiskPoolEnabled: pooled, remoteDiskAccountId: account.id, remoteDiskRootId: rootId },
      })
      if (!update.count) return { status: 404, message: 'O vínculo foi encerrado durante a configuração.' }
      return { status: 200 }
    }, { timeout: 25_000 })
    return res.status(result.status).json(result.message ? { message: result.message } : { status: 'ok' })
  } catch (error) {
    if (error instanceof DavError) return res.status(error.status).json({ message: error.message })
    return next(error)
  }
})

remoteDiskSettingsRouter.get('/devices/:id/roots', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const device = await prisma.desktopDevice.findFirst({ where: { id, userId: req.user!.id } })
    if (!device?.remoteDiskAccountId || !device.remoteDiskRootId) {
      return res.status(404).json({ message: 'Disco remoto não encontrado.' })
    }
    const tree = await treeFor({ ...device, remoteDiskAccountId: device.remoteDiskAccountId, remoteDiskRootId: device.remoteDiskRootId })
    const roots = await Promise.allSettled(tree.mounts.map(mount => tree.providerRoot(mount)))
    return res.json({
      roots: roots.flatMap(result => result.status === 'fulfilled' && result.value
        ? [{ accountId: result.value.mount.account.id, rootId: result.value.file.id }] : []),
      unavailableAccounts: roots.filter(result => result.status === 'rejected').length,
    })
  } catch (error) {
    if (error instanceof DavError) return res.status(error.status).json({ message: error.message })
    return next(error)
  }
})

remoteDiskSettingsRouter.post('/mount-key', async (req: AuthRequest, res, next) => {
  try {
    const key = randomBytes(32).toString('base64url')
    const { count } = await prisma.desktopDevice.updateMany({
      where: {
        userId: req.user!.id, sessionId: req.user!.sessionId, revokedAt: null,
        remoteDiskEnabled: true, remoteDiskRootId: { not: null }, session: { ...activeSession(), client: 'desktop' },
      },
      data: { remoteDiskKeyHash: keyHash(key) },
    })
    if (!count) return res.status(409).json({ message: 'Ative o disco remoto deste PC na tela Computadores.' })
    return res.json({ key })
  } catch (error) { return next(error) }
})


function parsePath(path: string) {
  const pieces = path.replace(/\/$/, '').split('/').slice(1).map(part => {
    try { return decodeURIComponent(part) }
    catch { throw new DavError(400, 'Caminho inválido.') }
  })
  if (pieces.length > 64 || pieces.some(part => !windowsName(part))) throw new DavError(400, 'Nome ou caminho incompatível com o Windows.')
  return pieces
}

function destinationPath(header: string | undefined, host: string | undefined) {
  // Analisa a parte codificada sem normalização de pontos por URL().
  const match = header?.match(/^(?:https:\/\/([^/?#]+))?(\/[^?#]*)$/i)
  if (!match || (match[1] && match[1].toLowerCase() !== host?.toLowerCase())) throw new DavError(400, 'Destino inválido.')
  const path = match[2]
  if (!path.startsWith(davPrefix + '/')) throw new DavError(403, 'Destino fora do disco remoto.')
  return parsePath(path.slice(davPrefix.length))
}

const xml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!))
const etag = (item: DiskFile) => '"' + item.id + '-' + (item.version ?? '0') + '"'

function prop(path: string[], item: DiskFile, quota?: { used: bigint; free: bigint }) {
  const folder = item.mimeType === folderMime
  const href = davPrefix + '/' + path.map(encodeURIComponent).join('/') + (folder && path.length ? '/' : '')
  const modified = new Date(item.modifiedTime ?? item.createdTime ?? 0).toUTCString()
  return '<D:response><D:href>' + xml(href) + '</D:href><D:propstat><D:prop>'
    + '<D:displayname>' + xml(item.name) + '</D:displayname><D:resourcetype>' + (folder ? '<D:collection/>' : '') + '</D:resourcetype>'
    + '<D:getcontentlength>' + (item.size ?? '0') + '</D:getcontentlength><D:getcontenttype>' + xml(item.mimeType) + '</D:getcontenttype>'
    + '<D:getlastmodified>' + modified + '</D:getlastmodified><D:getetag>' + xml(etag(item)) + '</D:getetag>'
    + (quota ? '<D:quota-used-bytes>' + quota.used + '</D:quota-used-bytes>'
      + '<D:quota-available-bytes>' + quota.free + '</D:quota-available-bytes>' : '')
    + '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
}

async function getDiskQuota(account: { id: string; provider: string }) {
  const cached = await prisma.storageAccount.findUnique({ where: { connectedAccountId: account.id } })
  const storage = cached?.lastSyncedAt && cached.lastSyncedAt.getTime() >= Date.now() - googleQuotaMaxAgeMs
    ? cached
    : await refreshAccountQuota(account).catch(() => cached)
  if (!storage || storage.totalBytes === null) return undefined
  const used = storage.usedBytes > storage.totalBytes ? storage.totalBytes : storage.usedBytes
  return { used, free: storage.totalBytes - used }
}

// Evita que dois clientes desta instância criem simultaneamente o mesmo caminho.
const mutations = new Map<string, Promise<void>>()
const recentWrites = new Map<string, symbol>()
async function mutate<T>(rootId: string, action: () => Promise<T>) {
  const previous = mutations.get(rootId)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  mutations.set(rootId, pending)
  try { await previous; return await action() }
  finally { release(); if (mutations.get(rootId) === pending) mutations.delete(rootId) }
}

function uploadSize(req: Request) {
  const length = req.get('content-length')
  if (length === undefined || !/^\d+$/.test(length)) throw new DavError(411, 'Informe o tamanho do arquivo.')
  const size = Number(length)
  if (!Number.isSafeInteger(size) || size > remoteFileLimit) throw new DavError(413, 'Arquivo acima do limite permitido.')
  return size
}

async function chooseUploadMount(tree: RemoteDiskTree, size: number) {
  if (tree.mounts.length === 1) return tree.mounts[0]
  const quotas = await Promise.all(tree.mounts.map(async mount => ({
    mount, quota: await getDiskQuota(mount.account).catch(() => undefined),
  })))
  const eligible = quotas.filter(candidate => candidate.quota && candidate.quota.free >= BigInt(size))
    .sort((a, b) => a.quota!.free > b.quota!.free ? -1 : a.quota!.free < b.quota!.free ? 1 : 0)
  const mount = eligible[0]?.mount ?? quotas.find(candidate => !candidate.quota)?.mount
  if (!mount) throw new DavError(507, 'Nenhuma conta do Google Drive tem espaço suficiente para este arquivo.')
  return mount
}

async function setTrashed(copy: DiskCopy, trashed: boolean) {
  const { drive } = await copy.mount.client()
  await drive.files.update({ fileId: copy.file.id, requestBody: { trashed }, fields: 'id' })
}

async function moveCopy(copy: DiskCopy, name: string, oldParent: DiskCopy, newParent: DiskCopy) {
  const { drive } = await copy.mount.client()
  await drive.files.update({
    fileId: copy.file.id, requestBody: { name },
    ...(oldParent.file.id !== newParent.file.id ? { addParents: newParent.file.id, removeParents: oldParent.file.id } : {}),
    fields: 'id',
  })
}

async function applyDiskChanges(changes: { apply(): Promise<void>; revert(): Promise<void> }[]) {
  const completed: typeof changes = []
  try {
    for (const change of changes) { await change.apply(); completed.push(change) }
  } catch (error) {
    for (const change of completed.reverse()) await change.revert().catch(() => undefined)
    throw error
  }
}

function requestAborted(req: Request) {
  const controller = new AbortController()
  if (req.destroyed && !req.complete) controller.abort()
  req.once('close', () => { if (!req.complete) controller.abort() })
  return controller.signal
}

type ImportProgress = {
  id: string; deviceId: string; fileName: string; size: number | null; bytes: number
  status: 'downloading' | 'completed' | 'failed'; message?: string
}
const imports = new Map<string, { progress: ImportProgress; controller: AbortController }>()
const importNames = new Map<string, string>()
const importRoute = '/devices/:id/import'
const localUploadRoute = '/devices/:id/upload'
const localParts = new Map<string, { id: string; deviceId: string; name: string; target: URL; size: number;
  offset: number; done: boolean; busy: boolean; account: DiskCopy['mount']['account'] }>()
let partRequests = 0

async function writableDisk(userId: string, id: string) {
  const device = await prisma.desktopDevice.findFirst({
    where: { id, userId, revokedAt: null, session: activeSession(), remoteDiskEnabled: true },
  })
  if (!device?.remoteDiskRootId || !device.remoteDiskAccountId) throw new DavError(404, 'Ative o disco remoto para salvar arquivos.')
  return { ...device, remoteDiskAccountId: device.remoteDiskAccountId, remoteDiskRootId: device.remoteDiskRootId }
}

async function newDiskFile(disk: Awaited<ReturnType<typeof writableDisk>>, name: string, size: number) {
  const tree = await treeFor(disk)
  const { ancestors, item } = await tree.locate(await tree.root(), [name])
  if (item || importNames.get(disk.userId) === nameKey(name)) {
    throw new DavError(409, 'Já existe um arquivo com esse nome ou um envio em andamento.')
  }
  const mount = await chooseUploadMount(tree, size)
  return tree.ensureFolder(ancestors, mount)
}

remoteDiskSettingsRouter.post(localUploadRoute, async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { name, size } = z.object({ name: z.string().max(255), size: z.number().int().min(0).max(remoteFileLimit) }).parse(req.body)
    if (!windowsName(name)) throw new DavError(400, 'O nome do arquivo precisa ser válido no Windows.')
    const userId = req.user!.id
    const disk = await writableDisk(userId, id)
    const result = await mutate(userId, async () => {
      if (localParts.get(userId)?.busy) throw new DavError(409, 'Aguarde o envio atual.')
      const parent = await newDiskFile(disk, name, size)
      const { auth, drive } = await parent.mount.client()
      const signal = AbortSignal.timeout(45_000)
      if (!size) {
        await saveDriveStream(Readable.from([]), drive, await auth.getRequestHeaders(), parent.file, name, 0, remoteFileLimit, signal)
        return { status: 'completed' }
      }
      const target = await startDriveUpload(await auth.getRequestHeaders(), { name, parents: [parent.file.id] }, size, signal)
      const job = { id: randomBytes(16).toString('hex'), deviceId: id, name, target, size, offset: 0, done: false, busy: false,
        account: parent.mount.account }
      localParts.set(userId, job)
      setTimeout(() => { if (localParts.get(userId) === job) localParts.delete(userId) }, 24 * 60 * 60_000).unref()
      return { status: 'uploading', id: job.id }
    })
    return res.status(201).json(result)
  } catch (error) {
    if (error instanceof DavError) return res.status(error.status).json({ message: error.message })
    return next(error)
  }
})

remoteDiskSettingsRouter.put(localUploadRoute + '/:jobId', async (req: AuthRequest, res) => {
  const job = localParts.get(req.user!.id)
  if (!job || job.id !== req.params.jobId || job.deviceId !== req.params.id) return res.status(404).json({ message: 'Envio expirado. Selecione o arquivo novamente.' })
  if (job.busy) return res.status(409).json({ message: 'Aguarde a confirmação do trecho.' })
  if (job.done) return res.json({ status: 'completed', offset: job.size })
  const range = req.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
  if (!range || Number(range[3]) !== job.size) return res.status(400).json({ message: 'Trecho inválido.' })
  const start = Number(range[1])
  const end = Number(range[2]) + 1
  const length = end - start
  if (start !== job.offset) {
    req.resume()
    return res.json({ status: 'uploading', offset: job.offset })
  }
  const declaredLength = req.get('Content-Length')
  if (!Number.isSafeInteger(end) || end > job.size || length < 1 || length > 32 * 1024 ** 2
    || (declaredLength !== undefined && Number(declaredLength) !== length)
    || (end !== job.size && length % (256 * 1024))) {
    return res.status(400).json({ message: 'Tamanho do trecho inválido.' })
  }
  if (partRequests >= 4) return res.set('Retry-After', '5').status(429).json({ message: 'Aguarde uma vaga para enviar o trecho.' })
  job.busy = true
  partRequests++
  try {
    await writableDisk(req.user!.id, job.deviceId)
    const part = Buffer.allocUnsafe(length)
    let received = 0
    for await (const data of req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
      if (received + data.length > length) throw new DavError(400, 'Tamanho do trecho inválido.')
      data.copy(part, received)
      received += data.length
    }
    if (received !== length) throw new DavError(400, 'O trecho chegou incompleto.')
    const signal = AbortSignal.any([requestAborted(req), AbortSignal.timeout(120_000)])
    const result = await sendDrivePart(job.target, part, start, end, job.size, signal)
    if (result.status === 308) {
      const position = result.headers.get('range')?.match(/^bytes=0-(\d+)$/)
      const offset = position ? Number(position[1]) + 1 : 0
      await result.body?.cancel()
      if (offset <= start || offset > end || offset >= job.size) throw new DavError(502, 'O Google Drive ainda não confirmou o arquivo.')
      job.offset = offset
      return res.json({ status: 'uploading', offset })
    }
    if (!result.ok) {
      await result.body?.cancel()
      throw new DavError(result.status >= 500 ? 502 : 422, 'O Google Drive recusou o trecho.')
    }
    const file = await result.json() as { id?: string; size?: string }
    if (end !== job.size || !file.id || file.size !== String(job.size)) throw new DavError(502, 'O Google Drive retornou um tamanho diferente do arquivo.')
    job.done = true
    job.offset = job.size
    void refreshAccountQuota(job.account).catch(() => undefined)
    return res.json({ status: 'completed', offset: job.size })
  } catch (error) {
    return res.status(error instanceof DavError ? error.status : 502).json({
      message: error instanceof DavError ? error.message : 'Não foi possível enviar o trecho ao Google Drive.',
    })
  } finally { job.busy = false; partRequests-- }
})

remoteDiskSettingsRouter.get(importRoute, (req: AuthRequest, res) => {
  const job = imports.get(req.user!.id)?.progress
  return res.json({ job: job?.deviceId === req.params.id ? job : null })
})

remoteDiskSettingsRouter.delete(importRoute, (req: AuthRequest, res) => {
  const job = imports.get(req.user!.id)
  if (job && job.progress.deviceId === req.params.id && job.progress.status === 'downloading') job.controller.abort()
  return res.json({ status: 'ok' })
})

remoteDiskSettingsRouter.post(importRoute, async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { url, fileName } = z.object({
      url: z.string().trim().max(4096), fileName: z.string().trim().max(255).optional(),
    }).parse(req.body)
    publicDownloadUrl(url)
    if (fileName && !windowsName(fileName)) throw new DavError(400, 'Escolha um nome de arquivo válido no Windows.')
    const userId = req.user!.id
    const disk = await writableDisk(userId, id)
    if (imports.get(userId)?.progress.status === 'downloading') throw new DavError(409, 'Já existe um download por link em andamento.')
    if ([...imports.values()].filter(job => job.progress.status === 'downloading').length >= 4) {
      throw new DavError(429, 'Os downloads por link estão ocupados. Aguarde e tente novamente.')
    }

    const progress: ImportProgress = { id: randomBytes(12).toString('hex'), deviceId: id, fileName: fileName || '',
      size: null, bytes: 0, status: 'downloading' }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(24 * 60 * 60_000)])
    const job = { progress, controller }
    imports.set(userId, job)
    res.status(202).json({ job: progress })
    void (async () => {
      let opened: Awaited<ReturnType<typeof openPublicDownload>> | undefined
      try {
        opened = await openPublicDownload(url, signal)
        const { response } = opened
        let fromUrl = new URL(response.url).pathname.split('/').at(-1) ?? ''
        try { fromUrl = decodeURIComponent(fromUrl) } catch { /* use the encoded name */ }
        const name = fileName || (windowsName(fromUrl) ? fromUrl : 'download')
        if (/^text\/html\b/i.test(response.headers.get('content-type') ?? '')
          && !/\.html?$/i.test(name) && !/^attachment\b/i.test(response.headers.get('content-disposition') ?? '')) {
          throw new DavError(422, 'O link abriu uma página. Copie o endereço direto do arquivo.')
        }
        const length = response.headers.get('content-length')
        const size = length === null ? undefined : Number(length)
        if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > remoteFileLimit)) {
          throw new DavError(413, 'Arquivo acima do limite permitido.')
        }
        progress.fileName = name
        progress.size = size ?? null
        const parent = await mutate(userId, async () => {
          signal.throwIfAborted()
          const activeLocal = localParts.get(userId)
          if (activeLocal && !activeLocal.done && nameKey(activeLocal.name) === nameKey(name)) {
            throw new DavError(409, 'Já existe um envio em andamento com esse nome.')
          }
          const parent = await newDiskFile(disk, name, size ?? 0)
          importNames.set(userId, nameKey(name))
          return parent
        })
        const mount = parent.mount
        const { drive, auth } = await mount.client()
        await saveDriveStream(Readable.fromWeb(response.body!), drive, await auth.getRequestHeaders(), parent.file,
          name, size, remoteFileLimit, signal, undefined, sent => { progress.bytes = sent })
        progress.status = 'completed'
        void refreshAccountQuota(mount.account).catch(() => undefined)
      } catch (error) {
        progress.status = 'failed'
        progress.message = controller.signal.aborted ? 'Download cancelado.' : error instanceof DavError ? error.message
          : 'Não foi possível concluir o download. Confira se o link ainda funciona e tente novamente.'
      } finally {
        importNames.delete(userId)
        await opened?.close().catch(() => undefined)
        setTimeout(() => { if (imports.get(userId) === job) imports.delete(userId) }, 15 * 60_000).unref()
      }
    })()
  } catch (error) {
    if (error instanceof DavError) return res.status(error.status).json({ message: error.message })
    return next(error)
  }
})

remoteDiskDavRouter.use(async (req, res: Response) => {
  res.set({ Allow: methods, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  try {
    const key = req.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
    if (!key) throw new DavError(401, 'Credencial do disco remoto necessária.')
    const device = await prisma.desktopDevice.findUnique({
      where: { remoteDiskKeyHash: keyHash(key) },
      include: { session: true, user: { select: { status: true, googleSubject: true } } },
    })
    if (!device || device.revokedAt || device.session.revokedAt || device.session.expiresAt <= new Date()
      || device.session.client !== 'desktop' || device.user.status !== 'active' || !device.user.googleSubject) throw new DavError(401, 'Vínculo do disco expirado.')
    let admitted = false
    await diskLimit(Object.assign(req, { diskDeviceId: device.id }), res, error => { if (error) throw error; admitted = true })
    if (!admitted) return
    if (!device.remoteDiskEnabled || !device.remoteDiskRootId || !device.remoteDiskAccountId) throw new DavError(403, 'O disco foi pausado no SingleDrive.')
    if (req.method === 'OPTIONS') { res.set('DAV', '1'); return res.status(204).end() }
    if (!methods.split(', ').includes(req.method)) throw new DavError(405, 'Operação não suportada.')
    const path = parsePath(req.path)
    const disk = { ...device, remoteDiskAccountId: device.remoteDiskAccountId, remoteDiskRootId: device.remoteDiskRootId }
    if (req.method === 'PROPFIND') {
      const depth = req.get('Depth')
      if (depth !== '0' && depth !== '1') throw new DavError(403, 'Use profundidade 0 ou 1.')
      const tree = await treeFor(disk)
      let properties: string
      if (depth === '0' && !path.length) {
        // O rclone consulta a cota com PROPFIND Depth: 0 na raiz.
        const quotas = await Promise.all(tree.mounts.map(mount => getDiskQuota(mount.account).catch(() => undefined)))
        const quota = quotas.filter(item => !!item).reduce<{ used: bigint; free: bigint } | undefined>(
          (sum, item) => ({ used: (sum?.used ?? 0n) + item.used, free: (sum?.free ?? 0n) + item.free }), undefined)
        properties = prop(path, { id: device.remoteDiskRootId, name: rootName, mimeType: folderMime }, quota)
      } else {
        const { item } = await tree.locate(await tree.root(), path)
        if (!item) throw new DavError(404, 'Item não encontrado.')
        const entries = depth === '1' && item.file.mimeType === folderMime ? await tree.children(item) : []
        properties = prop(path, item.file) + entries.map(child => prop([...path, child.file.name], child.file)).join('')
      }
      return res.status(207).type('application/xml').send('<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">'
        + properties + '</D:multistatus>')
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const tree = await treeFor(disk)
      const { item: entry } = await tree.locate(await tree.root(), path)
      if (!entry) throw new DavError(404, 'Arquivo não encontrado.')
      const item = entry.file
      if (item.mimeType === folderMime) throw new DavError(405, 'Consulte pastas com PROPFIND.')
      res.set({ 'ETag': etag(item), 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' })
      if (req.method === 'HEAD') return res.set('Content-Length', item.size ?? '0').end()
      const { auth } = await entry.copies[0].mount.client()
      const headers = await auth.getRequestHeaders()
      const range = req.get('Range')
      if (range) headers.set('Range', range)
      const response = await streamFetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(item.id) + '?alt=media', {
        headers: Object.fromEntries(headers), redirect: 'error', signal: AbortSignal.timeout(10 * 60_000),
      })
      if (!response.ok) {
        const rangeInfo = response.headers.get('content-range')
        if (rangeInfo) res.set('Content-Range', rangeInfo)
        await response.body?.cancel()
        throw new DavError(response.status, 'O Google Drive não entregou o arquivo.')
      }
      for (const header of ['content-length', 'content-range']) {
        const value = response.headers.get(header)
        if (value !== null) res.set(header, value)
      }
      res.status(response.status)
      if (response.body) await pipeline(Readable.fromWeb(response.body), res)
      else res.end()
      return
    }

    if (!path.length) throw new DavError(403, 'A raiz do disco não pode ser modificada.')
    await mutate(device.userId, async () => {
      // Revalida a política, pois esta operação pode ter ficado na fila.
      const allowed = await prisma.desktopDevice.findFirst({
        where: { id: device.id, remoteDiskKeyHash: device.remoteDiskKeyHash, remoteDiskEnabled: true,
          remoteDiskPoolEnabled: device.remoteDiskPoolEnabled, revokedAt: null, session: activeSession() },
        select: { id: true },
      })
      if (!allowed || req.destroyed) throw new DavError(403, 'Vínculo indisponível.')
      const tree = await treeFor(disk)
      const name = path.at(-1)!
      const local = localParts.get(device.userId)
      const reserved = [importNames.get(device.userId), local && !local.done ? nameKey(local.name) : undefined]
      if (path.length === 1 && reserved.includes(nameKey(name))) throw new DavError(409, 'Aguarde a conclusão do envio.')
      const writeKey = JSON.stringify([device.id, path.map(nameKey)])
      if (req.method === 'PUT') {
        const mark = Symbol()
        recentWrites.set(writeKey, mark)
        let committed = false
        try {
          const size = uploadSize(req)
          const { ancestors, item } = await tree.locate(await tree.root(), path)
          if (req.get('If-None-Match') === '*' && item) throw new DavError(412, 'Este arquivo já existe.')
          if (item?.file.mimeType === folderMime) throw new DavError(409, 'Já existe uma pasta com este nome.')
          const mount = item?.copies[0].mount ?? await chooseUploadMount(tree, size)
          const parent = await tree.ensureFolder(ancestors, mount)
          const { auth, drive } = await mount.client()
          try {
            await saveDriveStream(req.iterator({ destroyOnReturn: false }), drive, await auth.getRequestHeaders(), parent.file, name, size, remoteFileLimit, requestAborted(req), item?.file)
          } finally {
            if (tree.mounts.length > 1) await refreshAccountQuota(mount.account).catch(() => undefined)
          }
          committed = true
          return res.status(item ? 204 : 201).end()
        } finally {
          // rclone envia DELETE logo após falha de PUT. Preserve o arquivo anterior
          // e também um envio concluído cuja confirmação se perdeu na rede.
          setTimeout(() => { if (recentWrites.get(writeKey) === mark) recentWrites.delete(writeKey) }, committed ? 3000 : 15_000).unref()
        }
      }
      if (req.method === 'DELETE' && recentWrites.has(writeKey)) {
        throw new DavError(409, 'Aguarde o envio recente antes de excluir este arquivo.')
      }
      const root = await tree.root()
      const { ancestors, item } = await tree.locate(root, path)
      if (req.method === 'MKCOL') {
        if (item) throw new DavError(405, 'Já existe um item neste caminho.')
        const parent = ancestors.at(-1)!.copies[0] ?? await tree.ensureFolder(ancestors, tree.mounts[0])
        await tree.createFolder(parent, name)
        return res.status(201).end()
      }
      if (!item) throw new DavError(404, 'Item não encontrado.')
      if (req.method === 'DELETE') {
        await applyDiskChanges(item.copies.map(copy => ({ apply: () => setTrashed(copy, true), revert: () => setTrashed(copy, false) })))
        return res.status(204).end()
      }
      const target = destinationPath(req.get('Destination'), req.get('Host'))
      if (!target.length) throw new DavError(403, 'A raiz do disco não pode ser substituída.')
      if (target.length === 1 && reserved.includes(nameKey(target[0]))) throw new DavError(409, 'Aguarde a conclusão do envio.')
      if (item.file.mimeType === folderMime && target.length > path.length && path.every((part, index) => nameKey(part) === nameKey(target[index]))) {
        throw new DavError(409, 'Uma pasta não pode ser movida para dentro dela mesma.')
      }
      const destination = await tree.locate(root, target)
      const samePath = destination.item?.file.id === item.file.id
      const existing = samePath ? undefined : destination.item?.copies[0]
      if (existing && (req.get('Overwrite') === 'F' || existing.file.mimeType === folderMime || item.file.mimeType === folderMime)) {
        throw new DavError(412, 'Já existe um item no destino.')
      }
      if (req.method === 'COPY' && item.file.mimeType === folderMime) throw new DavError(405, 'Copie os arquivos da pasta para um novo destino.')
      if (req.method === 'COPY' && samePath) throw new DavError(403, 'Escolha outro nome para a cópia.')
      const nextName = target.at(-1)!
      const changes = existing ? [{ apply: () => setTrashed(existing, true), revert: () => setTrashed(existing, false) }] : []
      for (const copy of item.copies) {
        const parent = ancestors.at(-1)!.copies.find(value => value.mount === copy.mount)!
        const dest = await tree.ensureFolder(destination.ancestors, copy.mount)
        if (req.method === 'COPY') {
          const { drive } = await copy.mount.client()
          const apply = async () => { await drive.files.copy({
            fileId: copy.file.id, requestBody: { name: nextName, parents: [dest.file.id] }, fields: 'id',
          }, { retry: false }) }
          changes.push({ apply, revert: async () => {} })
        } else {
          changes.push({ apply: () => moveCopy(copy, nextName, parent, dest), revert: () => moveCopy(copy, copy.file.name, dest, parent) })
        }
      }
      await applyDiskChanges(changes)
      return res.status(existing ? 204 : 201).end()
    })
  } catch (error) {
    if (res.headersSent) { res.destroy(); return }
    const code = error instanceof DavError ? error.status : Number((error as { response?: { status?: number } })?.response?.status)
    const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502
    // Os erros do cliente Google podem conter URLs de upload e cabeçalhos sensíveis.
    res.removeHeader('Content-Disposition')
    res.removeHeader('Content-Length')
    if (status === 401) res.set('WWW-Authenticate', 'Bearer')
    res.status(status).json({ message: error instanceof DavError ? error.message : 'O Google Drive não concluiu a operação.' })
  }
})
