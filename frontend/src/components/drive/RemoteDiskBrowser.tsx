import { useEffect, useState } from 'react'
import { ChevronRight, Download, File, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch, apiFetchRaw, formatBytes } from '@/lib/api'

type DiskItem = { id: string; name: string; mimeType: string; accountId: string; size?: string }
const folderMime = 'application/vnd.google-apps.folder'
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

export function RemoteDiskBrowser({ deviceId }: { deviceId: string }) {
  const [path, setPath] = useState<string[]>([])
  const [items, setItems] = useState<DiskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setDownloadError('')
    const query = new URLSearchParams({ path: path.join('/') })
    apiFetch<{ items: DiskItem[] }>(`/remote-disk/devices/${deviceId}/files?${query}`)
      .then(result => {
        if (!active) return
        setItems(result.items.sort((a, b) =>
          Number(b.mimeType === folderMime) - Number(a.mimeType === folderMime) || collator.compare(a.name, b.name)))
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o disco.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [deviceId, path, revision])

  async function download(item: DiskItem) {
    setDownloadError('')
    try {
      const response = await apiFetchRaw(`/connected-accounts/${encodeURIComponent(item.accountId)}/drive/items/${encodeURIComponent(item.id)}/download`)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = item.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : 'Não foi possível baixar o arquivo.')
    }
  }

  return <section className="mt-6" aria-label="Arquivos do disco remoto">
    <h3 className="text-lg font-bold">Arquivos do disco remoto</h3>
    <Card className="mt-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <nav aria-label="Caminho no disco remoto" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button className="font-bold text-blue-700 hover:underline" onClick={() => setPath([])}>SingleDrive</button>
          {path.map((name, index) => <span key={index} className="inline-flex min-w-0 items-center gap-1">
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            <button className="truncate text-slate-700 hover:underline" onClick={() => setPath(path.slice(0, index + 1))}>{name}</button>
          </span>)}
        </nav>
        <Button disabled={loading} size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}>Atualizar arquivos</Button>
      </div>
      {loading && <p role="status" className="p-4 text-sm text-slate-500">Carregando arquivos…</p>}
      {error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
      {downloadError && <p role="alert" className="p-4 text-sm text-red-700">{downloadError}</p>}
      {!loading && !error && (items.length ? <ul className="divide-y divide-slate-100">
        {items.map(item => {
          const isFolder = item.mimeType === folderMime
          return <li key={item.name} className="flex items-center gap-3 px-4 py-3 text-sm">
            {isFolder ? <Folder className="h-5 w-5 shrink-0 text-blue-600" /> : <File className="h-5 w-5 shrink-0 text-slate-400" />}
            {isFolder
              ? <button className="min-w-0 flex-1 break-words text-left font-semibold hover:underline" onClick={() => setPath([...path, item.name])}>{item.name}</button>
              : <span className="min-w-0 flex-1 break-words">{item.name}</span>}
            {!isFolder && item.size && <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{formatBytes(item.size)}</span>}
            {!isFolder && <Button size="sm" variant="ghost" onClick={() => void download(item)} aria-label={`Baixar ${item.name}`} title="Baixar"><Download className="h-4 w-4" /></Button>}
          </li>
        })}
      </ul> : <p className="p-4 text-sm text-slate-500">Esta pasta está vazia.</p>)}
    </Card>
  </section>
}
