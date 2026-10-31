import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { apiFetch, formatBytes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Account = { id: string; email: string; provider: string; status: string }
type Item = { id: string; name: string; mimeType: string; size?: string; trashedTime?: string; explicitlyTrashed?: boolean; capabilities?: { canDelete?: boolean } }
type Page = { items: Item[]; nextPageToken: string | null }

function AccountTrash({ account, hidden, onRestored, busy }: { account: Account; hidden: Set<string>; onRestored: () => void; busy: boolean }) {
  const [items, setItems] = useState<Item[]>([])
  const [nextPage, setNextPage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const base = `/connected-accounts/${encodeURIComponent(account.id)}/drive`

  async function load(token?: string) {
    setLoading(true)
    setError('')
    try {
      const query = token ? `?${new URLSearchParams({ pageToken: token })}` : ''
      const data = await apiFetch<Page>(`${base}/trash${query}`)
      setItems((current) => token ? [...current, ...data.items] : data.items)
      setNextPage(data.nextPageToken)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a lixeira.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [account.id])

  async function restore(item: Item) {
    setLoading(true)
    setError('')
    try {
      await apiFetch(`${base}/items/${encodeURIComponent(item.id)}/restore`, { method: 'POST' })
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      onRestored()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível restaurar o item.') }
    finally { setLoading(false) }
  }

  async function deletePermanently(item: Item) {
    if (!window.confirm(`Excluir “${item.name}” permanentemente da conta ${account.email}? O arquivo não poderá ser recuperado pela lixeira.`)) return
    setLoading(true)
    setError('')
    try {
      await apiFetch(`${base}/items/${encodeURIComponent(item.id)}/permanent`, { method: 'DELETE' })
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      onRestored()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o item.') }
    finally { setLoading(false) }
  }

  const visible = items.filter((item) => !hidden.has(`${account.id}:${item.id}`))
  return <Card className="mt-4 overflow-hidden p-4">
    <h3 className="font-semibold">{account.email}</h3>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!loading && !error && visible.length === 0 && <p className="mt-2 text-sm text-slate-500">Nenhum item adicional nesta página.</p>}
    <ul className="mt-2 divide-y divide-slate-100">{visible.map((item) => <li key={item.id} className="flex items-center gap-3 py-3 text-sm">
      <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
      <span className="text-xs text-slate-500">{item.mimeType === 'application/vnd.google-apps.folder' ? 'Pasta' : formatBytes(item.size)}</span>
      {item.mimeType !== 'application/vnd.google-apps.folder' && item.explicitlyTrashed && <Button size="sm" variant="outline" disabled={loading || busy} onClick={() => void restore(item)}><RotateCcw className="h-4 w-4" /> Restaurar</Button>}
      {item.mimeType !== 'application/vnd.google-apps.folder' && item.explicitlyTrashed && item.capabilities?.canDelete && <Button size="sm" variant="danger" disabled={loading || busy} onClick={() => void deletePermanently(item)} aria-label={`Excluir ${item.name} permanentemente`}><Trash2 className="h-4 w-4" /> Excluir</Button>}
    </li>)}</ul>
    {loading && <p className="mt-2 text-sm text-slate-500">Carregando...</p>}
    {nextPage && !loading && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load(nextPage)}>Carregar mais</Button>}
  </Card>
}

export function GoogleTrash({ hidden, onRestored }: { hidden: Set<string>; onRestored: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [emptying, setEmptying] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    apiFetch<{ accounts: Account[] }>('/connected-accounts').then((data) => setAccounts(data.accounts.filter((account) => account.provider === 'google_drive' && account.status === 'connected'))).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as contas.') )
  }, [])
  async function emptyAll() {
    if (!accounts.length || !window.confirm(`Esvaziar permanentemente a lixeira do Meu Drive das ${accounts.length} conta(s) Google conectada(s)? Todos os arquivos e pastas dessas lixeiras serão excluídos sem possibilidade de recuperação. Drives compartilhados podem não ser esvaziados.`)) return
    setEmptying(true)
    setError('')
    setMessage('')
    const failed: string[] = []
    for (const account of accounts) {
      try { await apiFetch(`/connected-accounts/${encodeURIComponent(account.id)}/drive/trash`, { method: 'DELETE' }) }
      catch { failed.push(account.email) }
    }
    setRevision((current) => current + 1)
    onRestored()
    if (failed.length) setError(`Não foi possível concluir o esvaziamento em: ${failed.join(', ')}. Verifique as lixeiras antes de tentar novamente.`)
    else setMessage('Solicitação concluída para todas as contas. Confira os itens de drives compartilhados separadamente.')
    setEmptying(false)
  }
  return <section className="mt-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Lixeira das contas Google Drive</h2><p className="mt-1 text-sm text-slate-500">Pastas são restauradas no Google Drive. O esvaziamento abrange o Meu Drive de cada conta.</p></div><Button variant="danger" disabled={emptying || !accounts.length} onClick={() => void emptyAll()}><Trash2 className="h-4 w-4" /> {emptying ? 'Esvaziando...' : 'Esvaziar todas as contas'}</Button></div>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}{message && <p role="status" className="mt-2 text-sm text-emerald-700">{message}</p>}{accounts.map((account) => <AccountTrash key={`${account.id}:${revision}`} account={account} hidden={hidden} onRestored={onRestored} busy={emptying} />)}</section>
}
