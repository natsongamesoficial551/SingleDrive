import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { apiFetch, formatBytes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Account = { id: string; email: string; provider: string; status: string }
type Item = { id: string; name: string; mimeType: string; size?: string; trashedTime?: string; explicitlyTrashed?: boolean }
type Page = { items: Item[]; nextPageToken: string | null }

function AccountTrash({ account, hidden, onRestored }: { account: Account; hidden: Set<string>; onRestored: () => void }) {
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

  const visible = items.filter((item) => !hidden.has(`${account.id}:${item.id}`))
  return <Card className="mt-4 overflow-hidden p-4">
    <h3 className="font-semibold">{account.email}</h3>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!loading && !error && visible.length === 0 && <p className="mt-2 text-sm text-slate-500">Nenhum item adicional nesta página.</p>}
    <ul className="mt-2 divide-y divide-slate-100">{visible.map((item) => <li key={item.id} className="flex items-center gap-3 py-3 text-sm">
      <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
      <span className="text-xs text-slate-500">{item.mimeType === 'application/vnd.google-apps.folder' ? 'Pasta' : formatBytes(item.size)}</span>
      {item.mimeType !== 'application/vnd.google-apps.folder' && item.explicitlyTrashed && <Button size="sm" variant="outline" disabled={loading} onClick={() => void restore(item)}><RotateCcw className="h-4 w-4" /> Restaurar</Button>}
    </li>)}</ul>
    {loading && <p className="mt-2 text-sm text-slate-500">Carregando...</p>}
    {nextPage && !loading && <Button size="sm" variant="outline" onClick={() => void load(nextPage)}>Carregar mais</Button>}
  </Card>
}

export function GoogleTrash({ hidden, onRestored }: { hidden: Set<string>; onRestored: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch<{ accounts: Account[] }>('/connected-accounts').then((data) => setAccounts(data.accounts.filter((account) => account.provider === 'google_drive' && account.status === 'connected'))).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as contas.') )
  }, [])
  return <section className="mt-8"><h2 className="text-lg font-bold">Lixeira das contas Google Drive</h2><p className="mt-1 text-sm text-slate-500">Itens de cada conta conectada. Pastas devem ser restauradas no Google Drive.</p>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}{accounts.map((account) => <AccountTrash key={account.id} account={account} hidden={hidden} onRestored={onRestored} />)}</section>
}
