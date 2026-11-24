import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ApiError, apiFetch, formatBytes } from '@/lib/api'

type LinkJob = { fileName: string; size: number | null; bytes: number; status: 'downloading' | 'completed' | 'failed'; message?: string }
type UploadJob = { file: File; id: string | null; offset: number }
const partSize = 32 * 1024 ** 2

export function RemoteDiskTransfers({ deviceId }: { deviceId: string }) {
  const endpoint = '/remote-disk/devices/' + deviceId
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [linkJob, setLinkJob] = useState<LinkJob | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [sending, setSending] = useState(false)
  const [upload, setUpload] = useState<UploadJob | null>(null)
  const [linkMessage, setLinkMessage] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let mounted = true
    async function check() {
      try {
        const result = await apiFetch<{ job: LinkJob | null }>(endpoint + '/import')
        if (mounted) setLinkJob(result.job)
      } catch { /* Keep the last status while the server reconnects. */ }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [endpoint])

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWaiting(true)
    setLinkMessage('')
    try {
      const { job } = await apiFetch<{ job: LinkJob }>(endpoint + '/import', {
        method: 'POST', body: JSON.stringify({ url: link, fileName: name }),
      })
      setLinkJob(job)
      setLink('')
      setName('')
    } catch (error) { setLinkMessage(error instanceof Error ? error.message : 'Não foi possível importar o link.') }
    finally { setWaiting(false) }
  }

  async function cancelLink() {
    setWaiting(true)
    try { await apiFetch(endpoint + '/import', { method: 'DELETE' }) }
    catch (error) { setLinkMessage(error instanceof Error ? error.message : 'Não foi possível cancelar.') }
    finally { setWaiting(false) }
  }

  async function send(job: UploadJob) {
    setSending(true)
    setUploadMessage('')
    let { file, id, offset } = job
    try {
      if (!id) {
        const result = await apiFetch<{ id?: string; status: string }>(endpoint + '/upload', {
          method: 'POST', body: JSON.stringify({ name: file.name, size: file.size }),
        })
        if (result.status !== 'completed' && !result.id) throw new Error('O servidor não iniciou o envio.')
        id = result.id ?? null
        setUpload({ file, id, offset })
      }
      while (id && offset < file.size) {
        const end = Math.min(offset + partSize, file.size)
        const result = await apiFetch<{ status: string; offset: number }>(endpoint + '/upload/' + id, {
          method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` },
          body: file.slice(offset, end),
        })
        if (!Number.isSafeInteger(result.offset) || result.offset <= offset || result.offset > end
          || (result.offset === file.size && result.status !== 'completed')) {
          throw new Error('O Google Drive ainda não confirmou o envio. Clique em Retomar envio.')
        }
        offset = result.offset
        setUpload({ file, id, offset })
      }
      setUpload(null)
      setUploadMessage(file.name + ' foi salvo no Google Drive.')
    } catch (error) {
      const expired = error instanceof ApiError && error.status === 404
      setUpload({ file, id: expired ? null : id, offset: expired ? 0 : offset })
      setUploadMessage(error instanceof Error ? error.message : 'Falha no envio. Clique em Retomar envio.')
    } finally { setSending(false) }
  }

  const running = linkJob?.status === 'downloading'
  const inputClasses = 'min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900'
  return <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 p-4">
    <form className="grid gap-2" onSubmit={event => void saveLink(event)}>
      <label className="grid gap-1 text-sm font-semibold">Link direto do arquivo
        <input className={inputClasses} type="url" required maxLength={4096} value={link}
          onChange={event => setLink(event.target.value)} placeholder="https://…" />
      </label>
      <label className="grid gap-1 text-sm">Nome do arquivo (opcional)
        <input className={inputClasses} maxLength={255} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={waiting || running}>Salvar link no disco</Button>
        {running && <Button type="button" variant="outline" disabled={waiting} onClick={() => void cancelLink()}>Cancelar download</Button>}
      </div>
      {linkJob && <p role="status" className="break-words text-sm text-slate-600">{linkJob.status === 'completed'
        ? linkJob.fileName + ' foi salvo no Google Drive.'
        : linkJob.status === 'failed' ? linkJob.message
        : `Baixando ${linkJob.fileName || 'arquivo'} · ${formatBytes(linkJob.bytes)}${linkJob.size === null ? '' : ' de ' + formatBytes(linkJob.size)}`}</p>}
      {linkMessage && <p role="alert" className="text-sm text-red-700">{linkMessage}</p>}
    </form>
    <div className="grid gap-2 border-t border-slate-200 pt-3">
      <p className="text-sm text-slate-600">Arquivos do PC são enviados diretamente para a raiz do disco. Mantenha esta página aberta durante o envio.</p>
      <input ref={fileInput} type="file" hidden onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void send({ file, id: null, offset: 0 })
      }} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={sending} onClick={() => fileInput.current?.click()}>Enviar arquivo do PC</Button>
        {upload && !sending && <Button type="button" variant="outline" onClick={() => void send(upload)}>Retomar envio</Button>}
      </div>
      {sending && upload && <p role="status" className="break-words text-sm text-slate-600">{upload.file.name} · {formatBytes(upload.offset)} de {formatBytes(upload.file.size)}</p>}
      {uploadMessage && <p role="status" className="break-words text-sm text-slate-600">{uploadMessage}</p>}
    </div>
  </div>
}
