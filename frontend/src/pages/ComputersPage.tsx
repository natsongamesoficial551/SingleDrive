import { useEffect, useState } from 'react'
import { Monitor, Pause, Play, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch } from '@/lib/api'

type Device = {
  id: string; name: string; appVersion: string; backupEnabled: boolean; runtimeStatus: string
  sourceNames: string[]; uploadedFiles: number; lastSeenAt: string; lastBackupAt: string | null
  revoked: boolean; online: boolean
}

const statuses: Record<string, string> = { idle: 'Aguardando', paused: 'Pausado', scanning: 'Conferindo arquivos', uploading: 'Enviando arquivos', error: 'Precisa de atenção no PC' }
const date = (value: string) => new Date(value).toLocaleString('pt-BR')

export function ComputersPage() {
  const [devices, setDevices] = useState<Device[]>([])
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

  return <>
    <PageHeader title="Computadores" description="Até 5 computadores por conta. Revogue vínculos antigos para liberar espaço." actions={
      <Button variant="outline" onClick={() => void load().catch(error => setMessage(error.message))}><RefreshCw className="h-4 w-4" />Atualizar</Button>
    } />
    <Card className="mt-6 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Monitor className="h-6 w-6" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold text-slate-950">Vincular este computador ({devices.filter(device => !device.revoked).length}/5)</h2>
          <p className="mt-2 text-sm text-slate-600">Abra o SingleDrive Desktop no Windows, entre com a mesma conta Google usada aqui e escolha uma pasta para proteger.</p>
          <a href="singledrive-desktop://backup" className="mt-4 inline-flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700">Abrir agente do SingleDrive</a>
          <p className="mt-3 text-xs text-slate-500">Para recuperar pastas após formatar, use Restaurar backup no agente Windows. O aplicativo precisa ter sido aberto pelo menos uma vez neste PC. O Windows pedirá autorização para abri-lo.</p>
        </div>
      </div>
    </Card>
    {message && <p role="status" className="mt-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
    <div className="mt-6 grid gap-4">
      {loading ? <Card className="p-6 text-sm text-slate-500">Carregando computadores…</Card> : devices.length === 0 ? <Card className="border-dashed p-8 text-center"><Monitor className="mx-auto h-9 w-9 text-blue-500" /><p className="mt-3 font-bold">Nenhum computador vinculado</p><p className="mt-2 text-sm text-slate-500">Depois de entrar no agente Windows, seu computador aparecerá aqui.</p></Card> : devices.map(device => <Card key={device.id} className="p-5">
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
        {!device.revoked && <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy === device.id} onClick={() => void change(device)}>{device.backupEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{device.backupEnabled ? 'Pausar backup' : 'Retomar backup'}</Button>
          <Button variant="danger" disabled={busy === device.id} onClick={() => setConfirmRevoke(device.id)}><Unplug className="h-4 w-4" />Revogar acesso</Button>
        </div>}
        {confirmRevoke === device.id && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>Revogar o acesso de {device.name}? Será necessário entrar novamente no agente. Os arquivos enviados serão mantidos.</p><div className="mt-3 flex gap-2"><Button variant="danger" disabled={busy === device.id} onClick={() => void change(device, true)}>Confirmar revogação</Button><Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancelar</Button></div></div>}
      </Card>)}
    </div>
    <p className="mt-6 flex items-start gap-2 text-sm text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />As pastas são escolhidas no PC. O agente só envia enquanto estiver em execução; exclusões locais não apagam as cópias já enviadas.</p>
  </>
}
