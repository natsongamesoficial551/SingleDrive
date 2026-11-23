import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { apiFetch } from '@/lib/api'
import { getAccessToken, setAuthSession, type AuthUser } from '@/lib/auth'
import { consumeDiscordFlow, startDiscordFlow } from '@/lib/discord-auth'
import { startGoogleAuth } from '@/lib/google-auth'

type DiscordStatus = {
  configured: boolean
  linked: boolean
  accessConfigured: boolean
  loginEnabled: boolean
  guildId: string | null
}

export function DiscordCommunityEntry() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (getAccessToken()) return <Navigate to="/discord/servidor" replace />

  async function signIn() {
    setBusy(true)
    setError('')
    try { await startGoogleAuth('login', window, 'essential', '/discord') }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o acesso.')
      setBusy(false)
    }
  }

  return <main className="flex min-h-screen items-center justify-center p-5">
    <Card className="w-full max-w-lg p-7">
      <h1 className="text-2xl font-bold">Vincular Discord ao servidor</h1>
      <p className="mt-3 text-sm text-slate-600">Entre no SingleDrive para confirmar sua conta do Discord e receber o cargo <strong>Seguindo</strong>.</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <Button className="mt-5" disabled={busy} onClick={() => void signIn()}>
        <GoogleLogo />{busy ? 'Aguarde…' : 'Entrar com Google'}
      </Button>
      <Link className="ml-4 text-sm underline" to="/login">Outras opções de entrada</Link>
    </Card>
  </main>
}

export function DiscordCallbackPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const query = new URLSearchParams(location.search)
    const code = query.get('code'), state = query.get('state')
    const flow = consumeDiscordFlow(state)
    const destination = flow === 'login' ? '/login' : flow === 'access' ? '/settings/discord-access' : '/discord/servidor'
    const signedIn = !!getAccessToken()
    window.history.replaceState(window.history.state, '', '/discord/callback')

    void (async () => {
      if (!code || !state) throw new Error('A autorização pelo Discord foi cancelada ou expirou.')
      const options = { method: 'POST', retry: false, body: JSON.stringify({ code, state }) }
      if (flow === 'login') {
        if (!signedIn) {
          const session = await apiFetch<{ accessToken: string; user: AuthUser }>('/auth/discord/login/complete', {
            ...options, skipAuth: true,
          })
          setAuthSession(session.accessToken, session.user)
        }
        navigate('/all-files', { replace: true })
        return
      }
      if (!signedIn) throw new Error('Entre novamente no SingleDrive antes de autorizar o Discord.')
      await apiFetch(flow === 'access' ? '/auth/discord/access/complete' : '/auth/discord/complete', options)
      navigate(destination, { replace: true })
    })().catch(reason => navigate(!signedIn && flow !== 'login' ? '/discord' : destination, {
      replace: true, state: { discordError: reason instanceof Error ? reason.message : 'Falha na autorização pelo Discord.' },
    }))
  }, [location.search, navigate])

  return <main className="flex min-h-screen items-center justify-center p-5" role="status">Confirmando autorização pelo Discord…</main>
}

export function DiscordLinkPage({ access = false }: { access?: boolean }) {
  const location = useLocation()
  const [status, setStatus] = useState<DiscordStatus>()
  const [error, setError] = useState(() => (location.state?.discordError as string | undefined) ?? '')
  const [busy, setBusy] = useState(false)
  const configured = access ? status?.accessConfigured : status?.configured
  const complete = access ? status?.loginEnabled : status?.linked

  useEffect(() => {
    void apiFetch<DiscordStatus>('/auth/discord').then(setStatus)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o Discord.'))
  }, [])

  async function continueVerification() {
    setError('')
    setBusy(true)
    try { await startDiscordFlow(access ? 'access' : 'community') }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a autorização.')
      setBusy(false)
    }
  }

  const title = access ? 'Login com Discord' : 'Vincular Discord'
  const description = access
    ? 'Habilite o Discord como opção de entrada no seu perfil SingleDrive.'
    : 'Confirme sua participação no servidor SingleDrive para receber o cargo Seguindo.'

  return <div>
    <PageHeader title={title} description={description} />
    <Card className="mt-5 max-w-xl p-6">
      <p className="text-sm text-slate-600">
        {access
          ? 'Você pode habilitar a entrada pelo Discord sem pertencer ao servidor. Essa autorização permite acessar seu perfil pelos botões de login.'
          : 'Entre no servidor primeiro e vincule sua conta aqui. O SingleBot atribui o cargo Seguindo após a confirmação.'}
      </p>
      {complete && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950" role="status">
        {access ? 'Login com Discord habilitado.' : 'Conta confirmada no servidor SingleDrive.'}
      </p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {configured === false && <p className="mt-4 text-sm text-slate-600" role="status">A autorização pelo Discord está indisponível no momento.</p>}
      {(!access || !complete) && <Button className="mt-5" disabled={busy || configured !== true} onClick={() => void continueVerification()}>
        {busy ? 'Aguarde…' : access ? 'Habilitar login com Discord' : 'Vincular ao servidor'}
      </Button>}
      {!access && status?.guildId && <div className="mt-4 text-sm">
        <a className="underline" href={`https://discord.com/channels/${status.guildId}`}>Abrir servidor no Discord</a>
      </div>}
      {access && <div className="mt-4 text-sm"><Link className="underline" to="/settings">Voltar às configurações</Link></div>}
    </Card>
  </div>
}
