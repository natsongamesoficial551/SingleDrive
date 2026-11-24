import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fetch } from 'undici'
import { DavError, folderMime, type DiskFile, type Drive } from './remote-disk-tree.js'

export const maxDriveFileBytes = 5 * 1024 ** 4
const partSize = 16 * 1024 ** 2
const mimeType = 'application/octet-stream'
const requestSignal = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(120_000)])

export async function startDriveUpload(auth: Headers, metadata: { name?: string; parents?: string[] }, size: number | undefined,
  signal: AbortSignal, item?: DiskFile) {
  const endpoint = 'https://www.googleapis.com/upload/drive/v3/files' + (item ? '/' + encodeURIComponent(item.id) : '')
  const created = await fetch(endpoint + '?uploadType=resumable&fields=id,size', {
    method: item ? 'PATCH' : 'POST', redirect: 'error', signal: requestSignal(signal), body: JSON.stringify(metadata),
    headers: { ...Object.fromEntries(auth), 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType,
      ...(size === undefined ? {} : { 'X-Upload-Content-Length': String(size) }) },
  })
  const location = created.headers.get('location')
  await created.body?.cancel()
  if (!created.ok || !location) throw new DavError(created.ok ? 502 : created.status, 'O Google Drive não iniciou o envio.')
  const target = new URL(location)
  if (target.origin !== 'https://www.googleapis.com' || !target.pathname.startsWith('/upload/drive/v3/files')) {
    throw new DavError(502, 'Endereço de envio do Google inválido.')
  }
  return target
}

export async function sendDrivePart(target: URL, body: Buffer, start: number, end: number, total: number | '*', signal: AbortSignal) {
  const send = (query = false) => fetch(target, {
    method: 'PUT', redirect: 'manual', signal: requestSignal(signal),
    headers: {
      'Content-Type': mimeType, 'Content-Length': query ? '0' : String(body.length),
      'Content-Range': query ? `bytes */${total}` : `bytes ${start}-${end - 1}/${total}`,
    },
    body: query ? undefined : body,
  })
  for (let attempt = 0; ; attempt++) {
    const reply = await send().catch(error => {
      if (attempt === 2 || signal.aborted) throw error
      return undefined
    })
    if (reply && (reply.status < 500 || attempt === 2)) return reply
    await reply?.body?.cancel()
    await delay(500 * 2 ** attempt, undefined, { signal })
    const state = await send(true).catch(() => undefined)
    if (state?.ok || (state?.status === 308 && Number(state.headers.get('range')?.match(/^bytes=0-(\d+)$/)?.[1]) + 1 > start)) {
      return state
    }
    await state?.body?.cancel()
  }
}

export async function saveDriveStream(source: AsyncIterable<Buffer | Uint8Array>, drive: Drive, auth: Headers,
  parent: DiskFile, name: string, size: number | undefined, limit: number, signal: AbortSignal, item?: DiskFile,
  progress?: (bytes: number) => void) {
  if (item?.mimeType === folderMime) throw new DavError(409, 'Já existe uma pasta com este nome.')
  const metadata = item ? {} : { name, parents: [parent.id] }
  let target: URL | undefined
  let total = 0
  let committed = 0
  let buffered = 0
  const buffer = Buffer.allocUnsafe(partSize)
  const put = async (last: boolean) => {
    target ??= await startDriveUpload(auth, metadata, size, signal, item)
    const end = committed + buffered
    const rangeTotal = size ?? (last ? total : '*')
    while (committed < end) {
      const remaining = end - committed
      const upload = await sendDrivePart(target, buffer.subarray(buffered - remaining, buffered), committed, end, rangeTotal, signal)
      if (upload.status === 308) {
        const range = upload.headers.get('range')?.match(/^bytes=0-(\d+)$/)
        const offset = range ? Number(range[1]) + 1 : 0
        await upload.body?.cancel()
        if (offset <= committed || offset > end || (last && offset === end)) {
          throw new DavError(502, 'O Google Drive não confirmou o envio completo.')
        }
        committed = offset
      } else {
        if (!upload.ok) {
          await upload.body?.cancel()
          throw new DavError(upload.status, 'O Google Drive recusou o envio.')
        }
        const result = await upload.json() as { id?: string; size?: string }
        if (!last || !result.id || result.size !== String(total)) {
          throw new DavError(502, 'O Google Drive retornou um tamanho diferente do arquivo esperado.')
        }
        committed = end
      }
      progress?.(committed)
    }
    buffered = 0
  }

  for await (const data of source) {
    signal.throwIfAborted()
    if (total + data.length > limit) throw new DavError(413, 'Arquivo acima do limite permitido.')
    if (size !== undefined && total + data.length > size) throw new DavError(422, 'A origem enviou mais bytes do que o esperado.')
    for (let offset = 0; offset < data.length;) {
      if (buffered === partSize) await put(false)
      const length = Math.min(partSize - buffered, data.length - offset)
      buffer.set(data.subarray(offset, offset + length), buffered)
      offset += length
      buffered += length
      total += length
    }
  }
  signal.throwIfAborted()
  if (size !== undefined && size !== total) throw new DavError(422, 'O arquivo recebido está incompleto.')
  if (total > 0) return put(true)
  const media = { mimeType, body: Readable.from([]) }
  const options = { retry: false, signal: requestSignal(signal) }
  if (item) await drive.files.update({ fileId: item.id, media, requestBody: metadata, fields: 'id' }, options)
  else await drive.files.create({ media, requestBody: metadata, fields: 'id' }, options)
}
