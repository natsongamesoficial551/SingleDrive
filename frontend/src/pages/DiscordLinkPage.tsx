import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { apiFetch } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { startGoogleAuth } from '@/lib/google-auth'

type DiscordStatus = { configured: boolean; linked: boolean; guildId: string | null }

export function DiscordLinkPage() {
  const location = useLocation()
  const fromDiscord = location.pathname === '/discord/callback'
  const [status, setStatus] = useState<DiscordStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(fromDiscord)
  const [verified, setVerified] = useState(false)
  const started = useRef(false)
  const signedIn = !!getAccessToken()

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      if (fromDiscord) {
        const query = new URLSearchParams(location.search)
        window.history.replaceState(window.history.state, '', '/discord')
        const code = query.get('code'), state = query.get('state')
        if (!signedIn) throw new Error('Entre com Google e comece a vinculação novamente.')
        if (!code || !state) throw new Error('A autorização pelo Discord foi cancelada ou expirou.')
        await apiFetch('/auth/discord/complete', {
          method: 'POST', retry: false, body: JSON.stringify({ code, state }),
        })
        setVerified(true)
      }
      if (signedIn) setStatus(await apiFetch<DiscordStatus>('/auth/discord'))
    })().catch(reason => setError(reason instanceof Error ? reason.message : 'Não foi possível verificar sua conta.'))
      .finally(() => setBusy(false))
  }, [fromDiscord, location.search, signedIn])

  async function continueVerification() {
    setError('')
    setBusy(true)
    try {
      if (!signedIn) {
        await startGoogleAuth('login', window, 'essential', '/discord')
        return
      }
      const data = await apiFetch<{ url: string }>('/auth/discord/start', { method: 'POST' })
      window.location.assign(data.url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a vinculação.')
      setBusy(false)
    }
  }

  return <main className="flex min-h-screen items-center justify-center p-5">
    <Card className="w-full max-w-lg p-7">
      <h1 className="text-2xl font-bold">Vincular Discord</h1>
      <p className="mt-3 text-sm text-slate-600">Entre no servidor SingleDrive e confirme sua conta do Discord para receber o cargo <strong>Seguindo</strong>.</p>
      <p className="mt-2 text-sm text-slate-600">A confirmação usa sua sessão do SingleDrive. Seu e-mail não é enviado ao Discord.</p>
      {(verified || status?.linked) && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950" role="status">{verified ? 'Conta confirmada. O cargo Seguindo foi aplicado no Discord.' : 'Você já vinculou uma conta Discord ao SingleDrive.'}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {signedIn && status && !status.configured && <p className="mt-4 text-sm text-slate-600" role="status">A verificação pelo Discord está indisponível no momento.</p>}
      <Button className="mt-5" disabled={busy || (signedIn && status?.configured === false)} onClick={() => void continueVerification()}>
        {!signedIn && <GoogleLogo />}
        {busy ? 'Aguarde…' : signedIn ? 'Continuar com Discord' : 'Entrar com Google'}
      </Button>
      <div className="mt-5 flex flex-wrap gap-4 text-sm">
        {status?.guildId && <a className="underline" href={`https://discord.com/channels/${status.guildId}`}>Abrir servidor no Discord</a>}
        <Link className="underline" to={signedIn ? '/settings' : '/'}>Voltar ao SingleDrive</Link>
      </div>
    </Card>
  </main>
}
