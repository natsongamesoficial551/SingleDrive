import type { ConnectedAccount } from '@prisma/client'
import { google, type drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient } from '../google/google.service.js'

export const folderMime = 'application/vnd.google-apps.folder'
export const rootName = 'Disco remoto SingleDrive'
export const googleFields = 'id,name,mimeType,size,modifiedTime,createdTime,version'
export type DiskFile = drive_v3.Schema$File & { id: string; name: string; mimeType: string }
export type Drive = drive_v3.Drive
type DriveClient = { auth: Awaited<ReturnType<typeof getAuthedGoogleClient>>; drive: Drive }
type DriveAccount = { account: ConnectedAccount; client(): Promise<DriveClient> }
export type DiskCopy = { mount: DriveAccount; file: DiskFile }
export type DiskEntry = { file: DiskFile; copies: DiskCopy[] }

export class DavError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
export const nameKey = (name: string) => name.normalize('NFC').toUpperCase()
export function windowsName(name: string) {
  return name.length > 0 && name.length <= 255 && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
    && !/[. ]$/.test(name)
    && !/^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(name)
    && !/[\uFFFE\uFFFF]/u.test(name)
}

function visible(file: drive_v3.Schema$File): file is DiskFile {
  return !!(file.id && file.name && file.mimeType && windowsName(file.name)
    && (file.mimeType === folderMime || !file.mimeType.startsWith('application/vnd.google-apps.')))
}

export async function findRoot(drive: Drive, userId: string) {
  const { data } = await drive.files.list({
    q: "trashed = false and 'root' in parents and mimeType = '" + folderMime
      + "' and appProperties has { key='singleDriveRemoteOwner' and value='" + quote(userId) + "' }",
    fields: 'files(id),nextPageToken', pageSize: 2, spaces: 'drive',
  }, { timeout: 8000 })
  if ((data.files?.length ?? 0) > 1 || data.nextPageToken) {
    throw new DavError(409, 'Há mais de uma pasta de disco remoto em uma das contas Google.')
  }
  return data.files?.[0]?.id ?? null
}

// O chamador mantém o lock do perfil durante a criação.
export async function ensureRoot(drive: Drive, userId: string) {
  const existing = await findRoot(drive, userId)
  if (existing) return existing
  const { data } = await drive.files.create({
    requestBody: { name: rootName, parents: ['root'], mimeType: folderMime, appProperties: { singleDriveRemoteOwner: userId } },
    fields: 'id',
  }, { timeout: 8000, retry: false })
  if (!data.id) throw new DavError(502, 'O Google Drive não retornou o identificador do disco.')
  return data.id
}

const rootCache = new Map<string, Promise<string | null>>()
function discoverRoot(mount: DriveAccount, userId: string) {
  const id = mount.account.id
  const cached = rootCache.get(id)
  if (cached) return cached
  const pending = mount.client().then(({ drive }) => findRoot(drive, userId))
  rootCache.set(id, pending)
  const clear = () => { if (rootCache.get(id) === pending) rootCache.delete(id) }
  pending.catch(clear)
  setTimeout(clear, 15_000).unref()
  return pending
}

async function listFolder(copy: DiskCopy) {
  const { drive } = await copy.mount.client()
  const result: DiskCopy[] = []
  let pageToken: string | undefined
  do {
    const { data } = await drive.files.list({
      q: "'" + quote(copy.file.id) + "' in parents and trashed = false",
      fields: 'nextPageToken,files(' + googleFields + ')', pageSize: 1000, spaces: 'drive', pageToken,
    })
    for (const file of data.files ?? []) if (visible(file)) result.push({ mount: copy.mount, file })
    pageToken = data.nextPageToken ?? undefined
  } while (pageToken)
  return result
}

export class RemoteDiskTree {
  readonly mounts: DriveAccount[]
  constructor(
    accounts: ConnectedAccount[],
    private readonly userId: string,
    private readonly anchorAccountId: string,
    private readonly anchorRootId: string,
  ) {
    this.mounts = accounts.map(account => {
      let client: Promise<DriveClient> | undefined
      return {
        account,
        client: () => client ??= getAuthedGoogleClient(account).then(auth => ({ auth, drive: google.drive({ version: 'v3', auth }) })),
      }
    })
  }

  async providerRoot(mount: DriveAccount) {
    const id = mount.account.id === this.anchorAccountId ? this.anchorRootId : await discoverRoot(mount, this.userId)
    if (!id) return undefined
    const { drive } = await mount.client()
    const { data } = await drive.files.get({ fileId: id, fields: googleFields + ',trashed,appProperties' })
    if (!visible(data) || data.trashed || data.mimeType !== folderMime || data.appProperties?.singleDriveRemoteOwner !== this.userId) {
      throw new DavError(409, 'Restaure a pasta do disco remoto no Google Drive.')
    }
    return { mount, file: data }
  }

  async root(): Promise<DiskEntry> {
    const copies = (await Promise.all(this.mounts.map(mount => this.providerRoot(mount)))).filter(copy => !!copy)
    return { file: { id: this.anchorRootId, name: rootName, mimeType: folderMime }, copies }
  }

  async children(parent: DiskEntry) {
    const copies = (await Promise.all(parent.copies.map(listFolder))).flat()
    const entries = new Map<string, DiskEntry>()
    for (const copy of copies) {
      const key = nameKey(copy.file.name)
      const previous = entries.get(key)
      if (!previous) {
        entries.set(key, { file: copy.file, copies: [copy] })
        continue
      }
      if (previous.file.mimeType !== folderMime || copy.file.mimeType !== folderMime
        || previous.copies.some(other => other.mount.account.id === copy.mount.account.id)) {
        throw new DavError(409, 'Há nomes duplicados no Google Drive. Renomeie os itens pelo site.')
      }
      previous.copies.push(copy)
    }
    return [...entries.values()]
  }

  async locate(root: DiskEntry, path: string[]) {
    const ancestors = [root]
    let item: DiskEntry | undefined = root
    for (const [index, part] of path.entries()) {
      if (item.file.mimeType !== folderMime) throw new DavError(409, 'O caminho contém um arquivo.')
      item = (await this.children(item)).find(child => nameKey(child.file.name) === nameKey(part))
      if (index === path.length - 1) break
      if (!item) throw new DavError(409, 'A pasta de destino não existe.')
      ancestors.push(item)
    }
    return { ancestors, item }
  }

  async ensureFolder(ancestors: DiskEntry[], mount: DriveAccount): Promise<DiskCopy> {
    const { drive } = await mount.client()
    const id = mount.account.id
    let parent = ancestors[0].copies.find(copy => copy.mount.account.id === id)
    if (!parent) {
      const rootId = await prisma.$transaction(async tx => {
        await tx.user.update({ where: { id: this.userId }, data: { updatedAt: new Date() } })
        return ensureRoot(drive, this.userId)
      }, { timeout: 25_000 })
      rootCache.delete(id)
      parent = { mount, file: { id: rootId, name: rootName, mimeType: folderMime } }
      ancestors[0].copies.push(parent)
    }
    for (const ancestor of ancestors.slice(1)) {
      const existing = ancestor.copies.find(copy => copy.mount.account.id === id)
      parent = existing ?? await this.createFolder(parent, ancestor.file.name)
      if (!existing) ancestor.copies.push(parent)
    }
    return parent
  }

  async createFolder(parent: DiskCopy, name: string): Promise<DiskCopy> {
    const { drive } = await parent.mount.client()
    const { data } = await drive.files.create({
      requestBody: { name, mimeType: folderMime, parents: [parent.file.id] }, fields: 'id',
    }, { retry: false })
    if (!data.id) throw new DavError(502, 'O Google Drive não retornou o identificador da pasta.')
    return { mount: parent.mount, file: { id: data.id, name, mimeType: folderMime } }
  }
}
