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
import { DavError, ensureRoot, folderMime, nameKey, RemoteDiskTree, rootName, windowsName,
  type DiskCopy, type DiskFile, type Drive } from './remote-disk-tree.js'

export const remoteDiskSettingsRouter = Router()
export const remoteDiskDavRouter = Router()
remoteDiskSettingsRouter.use(requireAuth)

const davPrefix = '/remote-disk/dav'
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
      const pooled = poolEnabled ?? device.remoteDiskPoolEnabled
      const selected = device.remoteDiskAccountId ?? accountId ?? (pooled ? (await tx.connectedAccount.findFirst({
        where: diskAccounts(userId), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
      }))?.id : undefined)
      if (!selected) throw new DavError(400, 'Selecione a conta Google Drive que vai guardar os arquivos.')
      if (device.remoteDiskRootId) {
        const available = await tx.connectedAccount.findFirst({ where: pooled ? diskAccounts(userId) : diskAccount(selected, userId) })
        if (!available) throw new DavError(404, 'Conecte uma conta Google Drive ao SingleDrive.')
        await tx.desktopDevice.updateMany({ where, data: { remoteDiskEnabled: true, remoteDiskPoolEnabled: pooled } })
        return { status: 200 }
      }
      const account = await tx.connectedAccount.findFirst({ where: diskAccount(selected, userId) })
      if (!account) throw new DavError(404, 'A conta Google Drive precisa estar conectada ao SingleDrive.')
      const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
      const rootId = await ensureRoot(drive, userId)
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
async function mutate(rootId: string, action: () => Promise<unknown>) {
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
  if (!Number.isSafeInteger(size) || size > env.MAX_UPLOAD_BYTES) throw new DavError(413, 'Arquivo acima do limite permitido.')
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

async function save(req: Request, drive: Drive, authHeaders: Headers, parent: DiskFile, name: string, size: number, item?: DiskFile) {
  const length = size.toString()
  if (item?.mimeType === folderMime) throw new DavError(409, 'Já existe uma pasta com este nome.')
  const mimeType = 'application/octet-stream'
  const metadata = item ? {} : { name, parents: [parent.id] }
  if (!size) {
    const media = { mimeType, body: Readable.from([]) }
    if (item) await drive.files.update({ fileId: item.id, media, requestBody: metadata, fields: 'id' }, { retry: false })
    else await drive.files.create({ media, requestBody: metadata, fields: 'id' }, { retry: false })
    return
  }
  const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), requestAborted(req)])
  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files' + (item ? '/' + encodeURIComponent(item.id) : '')
  const init = await streamFetch(uploadUrl + '?uploadType=resumable&fields=id', {
    method: item ? 'PATCH' : 'POST',
    headers: {
      ...Object.fromEntries(authHeaders), 'Content-Type': 'application/json',
      'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': length,
    },
    body: JSON.stringify(metadata), redirect: 'error', signal,
  })
  const location = init.headers.get('location')
  await init.body?.cancel()
  if (!init.ok || !location) throw new DavError(init.ok ? 502 : init.status, 'O Google Drive não iniciou o envio.')
  const target = new URL(location)
  if (target.origin !== 'https://www.googleapis.com' || !target.pathname.startsWith('/upload/drive/v3/files')) {
    throw new DavError(502, 'Endereço de envio do Google inválido.')
  }
  const upload = await streamFetch(target, {
    method: 'PUT', headers: { 'Content-Type': mimeType, 'Content-Length': length, 'Content-Range': 'bytes 0-' + (size - 1) + '/' + length },
    body: req, duplex: 'half', redirect: 'error', signal,
  })
  await upload.body?.cancel()
  if (!upload.ok) throw new DavError(upload.status === 308 ? 502 : upload.status, 'O Google Drive não confirmou o arquivo completo.')
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
            await save(req, drive, await auth.getRequestHeaders(), parent.file, name, size, item?.file)
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
