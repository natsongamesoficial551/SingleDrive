import { createHash, randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { google, type drive_v3 } from 'googleapis'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetch as streamFetch } from 'undici'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { getAuthedGoogleClient } from '../google/google.service.js'

export const remoteDiskSettingsRouter = Router()
export const remoteDiskDavRouter = Router()
remoteDiskSettingsRouter.use(requireAuth)

const folderMime = 'application/vnd.google-apps.folder'
const rootName = 'Disco remoto SingleDrive'
const davPrefix = '/remote-disk/dav'
const methods = 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, COPY, MOVE, DELETE'
const activeSession = () => ({ revokedAt: null, expiresAt: { gt: new Date() } })
const keyHash = (key: string) => createHash('sha256').update(key).digest('hex')
const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const diskAccount = (id: string, userId: string) => ({ id, userId, provider: 'google_drive' as const, status: 'connected' as const })
const googleFields = 'id,name,mimeType,size,modifiedTime,createdTime,version'
type DiskFile = drive_v3.Schema$File & { id: string; name: string; mimeType: string }
type Drive = drive_v3.Drive
class DavError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

remoteDiskSettingsRouter.put('/devices/:id', async (req: AuthRequest, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id)
    const { enabled, accountId } = z.object({ enabled: z.boolean(), accountId: z.string().uuid().optional() }).parse(req.body)
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
        await tx.desktopDevice.updateMany({ where, data: { remoteDiskEnabled: false, remoteDiskMounted: false } })
        return { status: 200 }
      }
      if (device.remoteDiskAccountId && accountId && accountId !== device.remoteDiskAccountId) {
        throw new DavError(409, 'O disco já tem uma conta Google vinculada. Use a conta original para preservar a fila de arquivos do PC.')
      }
      const selected = device.remoteDiskAccountId ?? accountId
      if (!selected) throw new DavError(400, 'Selecione a conta Google Drive que vai guardar os arquivos.')
      const account = await tx.connectedAccount.findFirst({ where: diskAccount(selected, userId) })
      if (!account) throw new DavError(404, 'A conta Google Drive precisa estar conectada ao SingleDrive.')
      if (device.remoteDiskRootId) {
        await tx.desktopDevice.updateMany({ where, data: { remoteDiskEnabled: true } })
        return { status: 200 }
      }
      // Um mesmo Google Drive pode ser conectado a mais de um perfil SingleDrive.
      // O identificador do perfil marca o diretório em vez de reutilizar pelo nome.
      const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
      const existing = await drive.files.list({
        q: "trashed = false and 'root' in parents and mimeType = '" + folderMime
          + "' and appProperties has { key='singleDriveRemoteOwner' and value='" + quote(userId) + "' }",
        fields: 'files(id),nextPageToken', pageSize: 2, spaces: 'drive',
      }, { timeout: 8000 })
      const folders = existing.data.files ?? []
      if (folders.length > 1 || existing.data.nextPageToken) throw new DavError(409, 'Há mais de uma pasta de disco remoto nesta conta Google.')
      const rootId = folders[0]?.id ?? (await drive.files.create({
        requestBody: {
          name: rootName, parents: ['root'], mimeType: folderMime, appProperties: { singleDriveRemoteOwner: userId },
        },
        fields: 'id',
      }, { timeout: 8000, retry: false })).data.id
      if (!rootId) throw new DavError(502, 'O Google Drive não retornou o identificador do disco.')
      const update = await tx.desktopDevice.updateMany({
        where, data: { remoteDiskEnabled: true, remoteDiskAccountId: account.id, remoteDiskRootId: rootId },
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

function nameKey(name: string) { return name.normalize('NFC').toUpperCase() }
function windowsName(name: string) {
  return name.length > 0 && name.length <= 255 && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
    && !/[. ]$/.test(name)
    && !/^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(name)
    && !/[\uFFFE\uFFFF]/u.test(name)
}

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

function visible(file: drive_v3.Schema$File): file is DiskFile {
  return !!(file.id && file.name && file.mimeType && windowsName(file.name)
    && (file.mimeType === folderMime || !file.mimeType.startsWith('application/vnd.google-apps.')))
}

async function children(drive: Drive, parentId: string) {
  const result: DiskFile[] = []
  let pageToken: string | undefined
  do {
    const { data } = await drive.files.list({
      q: "'" + quote(parentId) + "' in parents and trashed = false",
      fields: 'nextPageToken,files(' + googleFields + ')', pageSize: 1000, spaces: 'drive', pageToken,
    })
    result.push(...(data.files ?? []).filter(visible))
    pageToken = data.nextPageToken ?? undefined
  } while (pageToken)
  return result
}

async function locate(drive: Drive, root: DiskFile, path: string[]) {
  let item = root
  let parent = root
  for (const [index, part] of path.entries()) {
    if (item.mimeType !== folderMime) throw new DavError(409, 'O caminho contém um arquivo.')
    parent = item
    const matches = (await children(drive, parent.id)).filter(child => nameKey(child.name) === nameKey(part))
    if (matches.length > 1) throw new DavError(409, 'Há nomes duplicados no Google Drive. Renomeie os itens no site.')
    if (!matches.length) {
      if (index < path.length - 1) throw new DavError(409, 'A pasta de destino não existe.')
      return { parent, item: undefined }
    }
    item = matches[0]
  }
  return { parent, item }
}

const xml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!))
const etag = (item: DiskFile) => '"' + item.id + '-' + (item.version ?? '0') + '"'

function prop(path: string[], item: DiskFile) {
  const folder = item.mimeType === folderMime
  const href = davPrefix + '/' + path.map(encodeURIComponent).join('/') + (folder && path.length ? '/' : '')
  const modified = new Date(item.modifiedTime ?? item.createdTime ?? 0).toUTCString()
  return '<D:response><D:href>' + xml(href) + '</D:href><D:propstat><D:prop>'
    + '<D:displayname>' + xml(item.name) + '</D:displayname><D:resourcetype>' + (folder ? '<D:collection/>' : '') + '</D:resourcetype>'
    + '<D:getcontentlength>' + (item.size ?? '0') + '</D:getcontentlength><D:getcontenttype>' + xml(item.mimeType) + '</D:getcontenttype>'
    + '<D:getlastmodified>' + modified + '</D:getlastmodified><D:getetag>' + xml(etag(item)) + '</D:getetag>'
    + '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
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

async function save(req: Request, drive: Drive, authHeaders: Headers, parent: DiskFile, name: string, item?: DiskFile) {
  const length = req.get('content-length')
  if (length === undefined || !/^\d+$/.test(length)) throw new DavError(411, 'Informe o tamanho do arquivo.')
  const size = Number(length)
  if (!Number.isSafeInteger(size) || size > env.MAX_UPLOAD_BYTES) throw new DavError(413, 'Arquivo acima do limite permitido.')
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
      include: { session: true, user: { select: { status: true } } },
    })
    if (!device || device.revokedAt || device.session.revokedAt || device.session.expiresAt <= new Date()
      || device.session.client !== 'desktop' || device.user.status !== 'active') throw new DavError(401, 'Vínculo do disco expirado.')
    if (!device.remoteDiskEnabled || !device.remoteDiskRootId || !device.remoteDiskAccountId) throw new DavError(403, 'O disco foi pausado no SingleDrive.')
    if (req.method === 'OPTIONS') { res.set('DAV', '1'); return res.status(204).end() }
    if (!methods.split(', ').includes(req.method)) throw new DavError(405, 'Operação não suportada.')
    const path = parsePath(req.path)
    const account = await prisma.connectedAccount.findFirst({ where: diskAccount(device.remoteDiskAccountId, device.userId) })
    if (!account) throw new DavError(403, 'Conta Google Drive desconectada.')
    const auth = await getAuthedGoogleClient(account)
    const drive = google.drive({ version: 'v3', auth })
    const root = (await drive.files.get({ fileId: device.remoteDiskRootId, fields: googleFields + ',trashed,appProperties' })).data
    if (!visible(root) || root.trashed || root.mimeType !== folderMime || root.appProperties?.singleDriveRemoteOwner !== device.userId) {
      throw new DavError(409, 'Restaure a pasta do disco remoto no Google Drive.')
    }
    if (req.method === 'PROPFIND') {
      const depth = req.get('Depth')
      if (depth !== '0' && depth !== '1') throw new DavError(403, 'Use profundidade 0 ou 1.')
      const { item } = await locate(drive, root, path)
      if (!item) throw new DavError(404, 'Item não encontrado.')
      const entries = depth === '1' && item.mimeType === folderMime ? await children(drive, item.id) : []
      const names = new Set<string>()
      for (const entry of entries) {
        const name = nameKey(entry.name)
        if (names.has(name)) throw new DavError(409, 'Há nomes duplicados nesta pasta no Google Drive.')
        names.add(name)
      }
      return res.status(207).type('application/xml').send('<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">'
        + prop(path, item) + entries.map(child => prop([...path, child.name], child)).join('') + '</D:multistatus>')
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const { item } = await locate(drive, root, path)
      if (!item) throw new DavError(404, 'Arquivo não encontrado.')
      if (item.mimeType === folderMime) throw new DavError(405, 'Consulte pastas com PROPFIND.')
      res.set({ 'ETag': etag(item), 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' })
      if (req.method === 'HEAD') return res.set('Content-Length', item.size ?? '0').end()
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
    await mutate(root.id, async () => {
      // Revalida a política, pois esta operação pode ter ficado na fila.
      const allowed = await prisma.desktopDevice.findFirst({
        where: { id: device.id, remoteDiskKeyHash: device.remoteDiskKeyHash, remoteDiskEnabled: true, revokedAt: null, session: activeSession() },
        select: { id: true },
      })
      if (!allowed || req.destroyed) throw new DavError(403, 'Vínculo indisponível.')
      const name = path.at(-1)!
      const writeKey = JSON.stringify([device.id, root.id, path.map(nameKey)])
      if (req.method === 'PUT') {
        const mark = Symbol()
        recentWrites.set(writeKey, mark)
        let committed = false
        try {
          const { parent, item } = await locate(drive, root, path)
          if (req.get('If-None-Match') === '*' && item) throw new DavError(412, 'Este arquivo já existe.')
          await save(req, drive, await auth.getRequestHeaders(), parent, name, item)
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
      const { parent, item } = await locate(drive, root, path)
      if (req.method === 'MKCOL') {
        if (item) throw new DavError(405, 'Já existe um item neste caminho.')
        await drive.files.create({ requestBody: { name, mimeType: folderMime, parents: [parent.id] }, fields: 'id' }, { retry: false })
        return res.status(201).end()
      }
      if (!item) throw new DavError(404, 'Item não encontrado.')
      if (req.method === 'DELETE') {
        await drive.files.update({ fileId: item.id, requestBody: { trashed: true }, fields: 'id' })
        return res.status(204).end()
      }
      const target = destinationPath(req.get('Destination'), req.get('Host'))
      if (!target.length) throw new DavError(403, 'A raiz do disco não pode ser substituída.')
      if (item.mimeType === folderMime && target.length > path.length && path.every((part, index) => nameKey(part) === nameKey(target[index]))) {
        throw new DavError(409, 'Uma pasta não pode ser movida para dentro dela mesma.')
      }
      const destination = await locate(drive, root, target)
      const existing = destination.item?.id === item.id ? undefined : destination.item
      if (existing && (req.get('Overwrite') === 'F' || existing.mimeType === folderMime || item.mimeType === folderMime)) {
        throw new DavError(412, 'Já existe um item no destino.')
      }
      if (req.method === 'COPY' && item.mimeType === folderMime) throw new DavError(405, 'Copie os arquivos da pasta para um novo destino.')
      if (req.method === 'COPY' && destination.item?.id === item.id) throw new DavError(403, 'Escolha outro nome para a cópia.')
      if (existing) await drive.files.update({ fileId: existing.id, requestBody: { trashed: true }, fields: 'id' })
      try {
        if (req.method === 'COPY') {
          await drive.files.copy({ fileId: item.id, requestBody: { name: target.at(-1), parents: [destination.parent.id] }, fields: 'id' }, { retry: false })
        } else {
          await drive.files.update({
            fileId: item.id, requestBody: { name: target.at(-1) },
            ...(destination.parent.id !== parent.id ? { addParents: destination.parent.id, removeParents: parent.id } : {}),
            fields: 'id',
          })
        }
      } catch (error) {
        if (existing) await drive.files.update({ fileId: existing.id, requestBody: { trashed: false }, fields: 'id' }).catch(() => undefined)
        throw error
      }
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
