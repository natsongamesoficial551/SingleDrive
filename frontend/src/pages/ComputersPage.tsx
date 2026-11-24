import { useEffect, useState } from 'react'
import { HardDrive, Monitor, Pause, Play, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch } from '@/lib/api'
import { Link, useSearchParams } from 'react-router-dom'
import { GoogleDriveBrowser, type GoogleDriveAccount } from '@/components/drive/GoogleDriveBrowser'
import { RemoteDiskTransfers } from '@/components/drive/RemoteDiskTransfers'

type Device = {
  id: string; name: string; appVersion: string; backupEnabled: boolean; runtimeStatus: string
  sourceNames: string[]; uploadedFiles: number; lastSeenAt: string; lastBackupAt: string | null
  revoked: boolean; online: boolean
  remoteDiskEnabled?: boolean; remoteDiskAccountId?: string | null; remoteDiskRootId?: string | null; remoteDiskMounted?: boolean
  remoteDiskPoolEnabled?: boolean
}

type DiskRoot = { accountId: string; rootId: string }

function DiskFiles({ device, accounts }: { device: Device; accounts: GoogleDriveAccount[] }) {
  const [roots, setRoots] = useState<DiskRoot[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    apiFetch<{ roots: DiskRoot[]; unavailableAccounts: number }>('/remote-disk/devices/' + device.id + '/roots')
      .then(result => {
        if (!active) return
        setRoots(result.roots)
        setSelected(result.roots[0]?.accountId ?? '')
        if (result.unavailableAccounts) setError('Algumas contas Google Drive estão indisponíveis.')
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o disco.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [device.id])

  const root = roots.find(item => item.accountId === selected)
  const account = accounts.find(item => item.id === selected)
  return <>
    {loading && <p className="mt-3 text-sm text-slate-500">Buscando os arquivos do disco…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!loading && !error && !roots.length && <p className="mt-3 text-sm text-slate-500">O disco ainda está vazio.</p>}
    {roots.length > 1 && <label className="mt-3 grid max-w-sm gap-1 text-sm font-semibold">Ver os arquivos da conta
      <select className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-slate-900" onChange={event => setSelected(event.target.value)} value={selected}>
        {roots.map(item => <option key={item.accountId} value={item.accountId}>{accounts.find(account => account.id === item.accountId)?.email}</option>)}
      </select>
    </label>}
    {root && account && <GoogleDriveBrowser key={root.rootId} accounts={[account]} remoteRootId={root.rootId} />}
  </>
}

const statuses: Record<string, string> = { idle: 'Aguardando', paused: 'Pausado', scanning: 'Conferindo arquivos', uploading: 'Enviando arquivos', error: 'Precisa de atenção no PC' }
const date = (value: string) => new Date(value).toLocaleString('pt-BR')

export function ComputersPage() {
  const [searchParams] = useSearchParams()
  const [devices, setDevices] = useState<Device[]>([])
  const [transferDevice, setTransferDevice] = useState<string | null>(() => searchParams.get('transfer'))
  const [accounts, setAccounts] = useState<GoogleDriveAccount[]>([])
  const [accountError, setAccountError] = useState('')
  const [diskBrowser, setDiskBrowser] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  async function load() {
    const data = await apiFetch<{ devices: Device[] }>('/desktop-devices')
    setDevices(data.devices)
    setLoading(false)
  }

  useEffect(() => {
    let disposed = false
    async function refresh() {
      try { if (!disposed) await load() }
      catch (error) { if (!disposed) { setMessage(error instanceof Error ? error.message : 'Não foi possível consultar os computadores.'); setLoading(false) } }
    }
    void refresh()
    apiFetch<{ accounts: GoogleDriveAccount[] }>('/connected-accounts')
      .then(result => {
        if (!disposed) setAccounts(result.accounts.filter(account => account.provider === 'google_drive' && account.status === 'connected'))
      })
      .catch(() => { if (!disposed) setAccountError('Não foi possível consultar as contas Google Drive.') })
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [])

  async function change(device: Device, revoke = false) {
    setBusy(device.id)
    setMessage('')
    try {
      await apiFetch(`/desktop-devices/${device.id}`, revoke
        ? { method: 'DELETE' }
        : { method: 'PATCH', body: JSON.stringify({ backupEnabled: !device.backupEnabled }) })
      setConfirmRevoke(null)
      setMessage(revoke ? 'Acesso do computador revogado. As cópias já enviadas foram preservadas.' : 'Preferência salva. O agente receberá a alteração na próxima conexão.')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o vínculo.') }
    finally { setBusy(null) }
  }

  async function changeDisk(device: Device, joinAccounts = false) {
    setBusy(device.id)
    setMessage('')
    try {
      const enabled = joinAccounts ? !!device.remoteDiskEnabled : !device.remoteDiskEnabled
      const enablePool = joinAccounts || !device.remoteDiskAccountId
      await apiFetch('/remote-disk/devices/' + device.id, {
        method: 'PUT', body: JSON.stringify({
          enabled, ...(enablePool ? { poolEnabled: true } : {}),
        }),
      })
      setMessage(joinAccounts ? 'Contas Google Drive unificadas neste disco.' : enabled
        ? 'Disco liberado. No PC, abra o aplicativo e clique em Conectar disco remoto.'
        : 'Acesso do PC ao disco pausado. Os arquivos continuam no Google Drive.')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível configurar o disco remoto.') }
    finally { setBusy(null) }
  }

  return <>
    <PageHeader title="Computadores" description="Até 10 computadores por conta. Revogue vínculos antigos para liberar espaço." actions={
      <Button variant="outline" onClick={() => void load().catch(error => setMessage(error.message))}><RefreshCw className="h-4 w-4" />Atualizar</Button>
    } />
    <Card className="mt-6 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Monitor className="h-6 w-6" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold text-slate-950">Vincular este computador ({devices.filter(device => !device.revoked).length}/10)</h2>
          <p className="mt-2 text-sm text-slate-600">Abra o SingleDrive Desktop no Windows e entre com a sua conta. Depois de formatar, use a mesma conta e clique em Restaurar disco remoto para reabrir as pastas que já foram salvas no Google Drive.</p>
          <a href="singledrive-desktop://backup" className="mt-4 inline-flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700">Abrir agente do SingleDrive</a>
          <p className="mt-3 text-xs text-slate-500">Para recuperar pastas locais incluídas no backup do PC, use Restaurar backup no agente Windows.</p>
        </div>
      </div>
    </Card>
    {message && <p role="status" className="mt-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
    <div className="mt-6 grid gap-4">
      {loading ? <Card className="p-6 text-sm text-slate-500">Carregando computadores…</Card> : devices.length === 0 ? <Card className="border-dashed p-8 text-center"><Monitor className="mx-auto h-9 w-9 text-blue-500" /><p className="mt-3 font-bold">Nenhum computador vinculado</p><p className="mt-2 text-sm text-slate-500">Depois de entrar no agente Windows, seu computador aparecerá aqui.</p></Card> : devices.map(device => {
        const original = accounts.find(account => account.id === device.remoteDiskAccountId)
        const diskAccounts = device.remoteDiskPoolEnabled ? accounts : original ? [original] : []
        const canEdit = !device.revoked && device.remoteDiskEnabled !== undefined
        const canRestoreDisk = !device.remoteDiskRootId && devices.some(other => other.id !== device.id && other.remoteDiskRootId)
        return <Card key={device.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words font-extrabold text-slate-950">{device.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{device.revoked ? 'Vínculo encerrado' : device.online ? 'Online' : 'Offline'} · Windows · v{device.appVersion}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{device.revoked ? 'Sem acesso' : !device.backupEnabled ? 'Backup pausado' : statuses[device.runtimeStatus] ?? 'Aguardando'}</span>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p>Pastas: {device.sourceNames.length ? device.sourceNames.join(', ') : 'Escolha no aplicativo Windows'}</p>
          <p>Arquivos no catálogo local: {device.uploadedFiles.toLocaleString('pt-BR')}</p>
          <p>Último contato: {date(device.lastSeenAt)}</p>
          <p>Última conferência concluída: {device.lastBackupAt ? date(device.lastBackupAt) : 'Aguardando'}</p>
        </div>
        {(canEdit || diskAccounts.length > 0) && <section className="mt-5 rounded-xl border border-slate-200 p-4" aria-label="Disco remoto">
          <h3 className="flex items-center gap-2 font-bold"><HardDrive className="h-4 w-4 text-blue-600" />Disco remoto</h3>
          <p className="mt-2 text-sm text-slate-600">{device.remoteDiskEnabled
            ? device.remoteDiskMounted ? 'Unidade montada no Explorador de Arquivos.' : 'Autorizado. Aguardando conexão no Windows.'
            : device.remoteDiskAccountId ? 'Acesso deste PC pausado.' : 'A unidade usa as contas Google Drive conectadas ao SingleDrive.'}</p>
          {canEdit && <div className="mt-3 flex flex-wrap items-center gap-2">
            {!!(device.remoteDiskAccountId || accounts.length) && <Button variant="outline" className="self-end" disabled={busy === device.id || (!device.remoteDiskEnabled && !!device.remoteDiskAccountId && !diskAccounts.length)} onClick={() => void changeDisk(device)}>
              {device.remoteDiskEnabled ? 'Pausar disco' : device.remoteDiskAccountId ? 'Retomar disco' : canRestoreDisk ? 'Restaurar disco remoto' : 'Ativar disco'}
            </Button>}
            {device.remoteDiskPoolEnabled === false && device.remoteDiskAccountId && accounts.length > 0 && <Button variant="outline" disabled={busy === device.id} onClick={() => void changeDisk(device, true)}>Unir contas Google Drive</Button>}
            {device.remoteDiskEnabled && <a href="singledrive-desktop://backup" className="self-end rounded-xl px-3 py-2 text-sm font-bold text-blue-700">Abrir aplicativo Windows</a>}
          </div>}
          {diskAccounts.length > 0 && <p className="mt-2 break-words text-sm text-slate-600">{diskAccounts.map(item => item.email).join(', ')}</p>}
          {canEdit && <p className="mt-2 text-sm text-slate-600">{accountError && <span>{accountError} </span>}<Link to="/settings" className="font-semibold text-blue-700">Gerenciar contas Google Drive</Link></p>}
          {diskAccounts.length > 0 && device.remoteDiskRootId && <Button variant="outline" className="mt-3" onClick={() => setDiskBrowser(current => current === device.id ? null : device.id)}>
            {diskBrowser === device.id ? 'Fechar arquivos' : 'Ver arquivos do disco'}
          </Button>}
          {diskBrowser === device.id && diskAccounts.length > 0 && device.remoteDiskRootId && (device.remoteDiskPoolEnabled
            ? <DiskFiles device={device} accounts={diskAccounts} />
            : <GoogleDriveBrowser key={device.remoteDiskRootId} accounts={diskAccounts} remoteRootId={device.remoteDiskRootId} />)}
          {canEdit && device.remoteDiskEnabled && device.remoteDiskRootId && <Button variant="outline" className="mt-3 ml-2"
            aria-expanded={transferDevice === device.id} onClick={() => setTransferDevice(current => current === device.id ? null : device.id)}>
            {transferDevice === device.id ? 'Ocultar transferências' : 'Salvar arquivos no disco'}
          </Button>}
          {canEdit && device.remoteDiskEnabled && device.remoteDiskRootId && transferDevice === device.id && <RemoteDiskTransfers key={device.id} deviceId={device.id} />}
        </section>}
        {!device.revoked && <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy === device.id} onClick={() => void change(device)}>{device.backupEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{device.backupEnabled ? 'Pausar backup' : 'Retomar backup'}</Button>
          <Button variant="danger" disabled={busy === device.id} onClick={() => setConfirmRevoke(device.id)}><Unplug className="h-4 w-4" />Revogar acesso</Button>
        </div>}
        {confirmRevoke === device.id && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>Revogar o acesso de {device.name}? Será necessário entrar novamente no agente. Os arquivos enviados serão mantidos.</p><div className="mt-3 flex gap-2"><Button variant="danger" disabled={busy === device.id} onClick={() => void change(device, true)}>Confirmar revogação</Button><Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancelar</Button></div></div>}
      </Card>
      })}
    </div>
    <p className="mt-6 flex items-start gap-2 text-sm text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />As pastas são escolhidas no PC. O agente só envia enquanto estiver em execução; exclusões locais não apagam as cópias já enviadas.</p>
  </>
}
