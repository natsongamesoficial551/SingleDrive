import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { apiFetch } from '@/lib/api'
import { getAccessToken, setAuthSession, type AuthUser } from '@/lib/auth'
import { consumeDiscordFlow, startDiscordFlow } from '@/lib/discord-auth'
import { isDesktopShell } from '@/lib/desktop-shell'
import { startGoogleAuth } from '@/lib/google-auth'

type DiscordStatus = {
  configured: boolean
  linked: boolean
  accessConfigured: boolean
  loginEnabled: boolean
  guildId: string | null
}

export function DiscordCommunityEntry() {
  const [busy, setBusy] = useState<'google' | 'discord' | null>(null)
  const [error, setError] = useState('')
  if (getAccessToken()) return <Navigate to="/discord/servidor" replace />

  async function signIn(provider: 'google' | 'discord') {
    setBusy(provider)
    setError('')
    try {
      if (provider === 'google') await startGoogleAuth('login', window, 'essential', '/discord')
      else await startDiscordFlow('login', '/discord/servidor')
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o acesso.')
      setBusy(null)
    }
  }

  return <main className="flex min-h-screen items-center justify-center p-5">
    <Card className="w-full max-w-lg p-7">
      <h1 className="text-2xl font-bold">Vincular Discord ao servidor</h1>
      <p className="mt-3 text-sm text-slate-600">Entre no SingleDrive para confirmar sua conta do Discord e receber o cargo <strong>Seguindo</strong>.</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={() => void signIn('google')}>
          <GoogleLogo />{busy === 'google' ? 'Aguarde…' : 'Entrar com Google'}
        </Button>
        <Button variant="outline" disabled={!!busy} onClick={() => void signIn('discord')}>
          <img src="/discord-mark.svg" alt="" className="h-4 w-4 shrink-0" />
          {busy === 'discord' ? 'Aguarde…' : 'Entrar com Discord'}
        </Button>
      </div>
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
    const { flow, returnTo } = consumeDiscordFlow(state)
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
        navigate(returnTo ?? '/all-files', { replace: true })
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
  const desktop = isDesktopShell()
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  const external = !access && (desktop || standalone)

  useEffect(() => {
    function refresh() {
      void apiFetch<DiscordStatus>('/auth/discord').then(setStatus)
        .catch(reason => setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o Discord.'))
    }
    refresh()
    if (!external) return
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [external])

  async function continueVerification() {
    setError('')
    setBusy(true)
    try { await startDiscordFlow(access ? 'access' : 'community') }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a autorização.')
      setBusy(false)
    }
  }

  if (external) {
    return <div>
      <PageHeader title="Vincular Discord" description="Confirme sua participação no servidor SingleDrive." />
      <Card className="mt-5 max-w-xl p-6">
        <p className="text-sm text-slate-600">Conclua a vinculação no seu navegador. Se ele pedir login, entre com o mesmo perfil SingleDrive que você usa no aplicativo.</p>
        <a className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          href={desktop ? 'singledrive-desktop://discord' : '/discord'}
          target={desktop ? undefined : '_blank'} rel={desktop ? undefined : 'noopener noreferrer'}>
          Abrir no navegador
        </a>
        {complete && <p className="mt-4 text-sm text-emerald-800" role="status">Conta confirmada no servidor SingleDrive.</p>}
      </Card>
    </div>
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
