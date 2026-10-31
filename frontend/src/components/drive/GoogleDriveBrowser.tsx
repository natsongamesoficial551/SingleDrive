import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Cloud, Download, ExternalLink, File, Folder, LoaderCircle, Pencil, Trash2, Upload } from 'lucide-react'
import { apiFetch, apiFetchRaw, formatBytes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Account = { id: string; provider: string; email: string; status: string }
type DriveItem = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string; capabilities?: { canRename?: boolean; canTrash?: boolean; canDownload?: boolean } }
type FolderPath = { id: string; name: string }
type BrowseResult = { items: DriveItem[]; nextPageToken: string | null }
const folderMimeType = 'application/vnd.google-apps.folder'

function safeGoogleLink(value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname) ? url.href : undefined
  } catch {
    return undefined
  }
}

export function GoogleDriveBrowser({ accounts }: { accounts: Account[] }) {
  const connected = accounts.filter((account) => account.provider === 'google_drive' && account.status === 'connected')
  const [accountId, setAccountId] = useState('')
  const [shared, setShared] = useState(false)
  const [path, setPath] = useState<FolderPath[]>([])
  const [items, setItems] = useState<DriveItem[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderId = path.at(-1)?.id ?? 'root'

  useEffect(() => {
    if (!accountId && connected[0]) setAccountId(connected[0].id)
  }, [accounts, accountId])

  useEffect(() => {
    if (!accountId) return
    let active = true
    const params = new URLSearchParams({ folderId, shared: String(shared) })
    setLoading(true)
    setError('')
    setItems([])
    setNextPageToken(null)
    apiFetch<BrowseResult>(`/connected-accounts/${encodeURIComponent(accountId)}/browse?${params}`)
      .then((data) => { if (active) { setItems(data.items); setNextPageToken(data.nextPageToken) } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os arquivos.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accountId, folderId, shared, revision])

  const drivePath = `/connected-accounts/${encodeURIComponent(accountId)}/drive`
  async function perform(action: () => Promise<void>) {
    setLoading(true)
    setError('')
    try { await action(); setRevision((value) => value + 1) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'A operação falhou.') }
    finally { setLoading(false) }
  }
  function rename(item: DriveItem) {
    const name = window.prompt('Novo nome:', item.name)?.trim()
    if (!name || name === item.name) return
    void perform(async () => { await apiFetch(`${drivePath}/items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }) })
  }
  function trash(item: DriveItem) {
    if (!window.confirm(`Enviar “${item.name}” para a lixeira do Google Drive? A alteração também aparece no Google Drive.`)) return
    void perform(async () => { await apiFetch(`${drivePath}/items/${encodeURIComponent(item.id)}/trash`, { method: 'POST' }) })
  }
  function createFolder() {
    const name = window.prompt('Nome da nova pasta:')?.trim()
    if (!name) return
    void perform(async () => { await apiFetch(`${drivePath}/folders`, { method: 'POST', body: JSON.stringify({ name, parentId: folderId }) }) })
  }
  function upload(file?: globalThis.File) {
    if (!file) return
    const params = new URLSearchParams({ name: file.name, parentId: folderId, mimeType: file.type || 'application/octet-stream' })
    void perform(async () => { await apiFetch(`${drivePath}/upload?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }) })
  }
  async function download(item: DriveItem) {
    setError('')
    try {
      const response = await apiFetchRaw(`${drivePath}/items/${encodeURIComponent(item.id)}/download`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.mimeType.startsWith('application/vnd.google-apps.') ? `${item.name}.pdf` : item.name
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível baixar o arquivo.') }
  }

  async function loadMore() {
    if (!nextPageToken || loading) return
    const params = new URLSearchParams({ folderId, shared: String(shared), pageToken: nextPageToken })
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<BrowseResult>(`/connected-accounts/${encodeURIComponent(accountId)}/browse?${params}`)
      setItems((current) => [...current, ...data.items])
      setNextPageToken(data.nextPageToken)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar mais arquivos.')
    } finally {
      setLoading(false)
    }
  }

  if (!connected.length) return null
  const account = connected.find((item) => item.id === accountId)
  return <section className="mt-8" aria-label="Arquivos das contas Google Drive" onContextMenu={(event) => event.stopPropagation()}>
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-bold">Explorar Google Drive</h2><p className="mt-1 text-sm text-slate-500">Navegue pelas pastas originais de cada conta conectada.</p></div></div>
    <div className="mt-4 flex flex-wrap gap-2">
      {connected.map((item) => <Button key={item.id} disabled={loading} variant={accountId === item.id ? 'soft' : 'outline'} size="sm" onClick={() => { setAccountId(item.id); setPath([]); setShared(false) }}><Cloud className="h-4 w-4" />{item.email}</Button>)}
    </div>
    {account && <Card className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm"><button disabled={loading} className="font-bold text-blue-600" onClick={() => setPath([])}>{shared ? 'Compartilhados comigo' : 'Meu Drive'}</button>{path.map((folder, index) => <span key={folder.id} className="inline-flex min-w-0 items-center gap-1"><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /><button disabled={loading} className="truncate text-slate-700 hover:underline" onClick={() => setPath(path.slice(0, index + 1))}>{folder.name}</button></span>)}</div>
        <div className="flex flex-wrap gap-2"><Button disabled={loading} size="sm" variant={!shared ? 'soft' : 'outline'} onClick={() => { setPath([]); setShared(false) }}>Meu Drive</Button><Button disabled={loading} size="sm" variant={shared ? 'soft' : 'outline'} onClick={() => { setPath([]); setShared(true) }}>Compartilhados comigo</Button></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3"><p className="text-xs text-slate-500">{account.email} · Alterações aqui também aparecem no Google Drive. Arquivos Google são baixados em PDF.</p><div className="flex gap-2"><input ref={inputRef} type="file" className="hidden" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} /><Button size="sm" variant="outline" disabled={loading || (shared && folderId === 'root')} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" /> Enviar arquivo</Button><Button size="sm" variant="outline" disabled={loading || (shared && folderId === 'root')} onClick={createFolder}>Nova pasta</Button></div></div>
      {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">Não foi possível carregar esta conta: {error}</p>}
      {!loading && !error && items.length === 0 && <p className="p-6 text-sm text-slate-500">Nenhum arquivo ou pasta encontrado aqui.</p>}
      <ul className="divide-y divide-slate-100">
        {items.map((item) => {
          const isFolder = item.mimeType === folderMimeType
          const link = safeGoogleLink(item.webViewLink)
          return <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            {isFolder ? <Folder className="h-5 w-5 shrink-0 text-blue-600" /> : <File className="h-5 w-5 shrink-0 text-slate-400" />}
            <span className="min-w-0 flex-1 truncate" title={item.name}>{isFolder ? <button disabled={loading} className="max-w-full truncate text-left font-semibold hover:underline" onClick={() => setPath((current) => [...current, { id: item.id, name: item.name }])}>{item.name}</button> : <span>{item.name}</span>}</span>
            {!isFolder && item.size && <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{formatBytes(item.size)}</span>}
            {!isFolder && item.capabilities?.canDownload && <button disabled={loading} onClick={() => void download(item)} aria-label={`Baixar ${item.name}`} title="Baixar" className="rounded p-1.5 text-slate-600 hover:bg-slate-100"><Download className="h-4 w-4" /></button>}
            {item.capabilities?.canRename && <button disabled={loading} onClick={() => rename(item)} aria-label={`Renomear ${item.name}`} title="Renomear" className="rounded p-1.5 text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>}
            {item.capabilities?.canTrash && <button disabled={loading} onClick={() => trash(item)} aria-label={`Enviar ${item.name} para a lixeira`} title="Enviar para a lixeira do Google Drive" className="rounded p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-blue-600" aria-label={`Abrir ${item.name} no Google Drive`}>Abrir <ExternalLink className="h-3.5 w-3.5" /></a>}
          </li>
        })}
      </ul>
      {loading && <p className="flex items-center gap-2 p-4 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Carregando arquivos...</p>}
      {nextPageToken && !loading && <div className="border-t border-slate-100 p-4"><Button size="sm" variant="outline" onClick={loadMore}>Carregar mais</Button></div>}
    </Card>}
  </section>
}
