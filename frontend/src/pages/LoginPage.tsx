import { useState } from 'react'
import { startGoogleAuth } from '@/lib/google-auth'
import { startDiscordFlow } from '@/lib/discord-auth'
import { useLocation } from 'react-router-dom'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { AuthStory } from '@/components/auth/AuthStory'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function LoginPage() {
  const location = useLocation()
  const [error, setError] = useState(() => (location.state?.discordError as string | undefined) ?? '')
  const [loading, setLoading] = useState<'google' | 'discord' | null>(null)

  async function signIn(provider: 'google' | 'discord') {
    setLoading(provider)
    setError('')
    try {
      if (provider === 'google') await startGoogleAuth('login')
      else await startDiscordFlow('login')
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o acesso.')
      setLoading(null)
    }
  }

  return <main className="sd-auth">
    <AuthStory />
    <div className="sd-auth-form">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-11 w-11" />
          <div><h1 className="text-2xl font-extrabold">Entre no SingleDrive</h1><p className="text-sm text-slate-500">Entre ou crie seu perfil com Google ou Discord.</p></div>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <Button className="mt-6 w-full" variant="outline" disabled={!!loading} onClick={() => void signIn('google')}>
          <GoogleLogo />{loading === 'google' ? 'Redirecionando…' : 'Continuar com Google'}
        </Button>
        <Button className="mt-3 w-full" variant="outline" disabled={!!loading} onClick={() => void signIn('discord')}>
          <img src="/discord-mark.svg" alt="" className="h-4 w-4 shrink-0" />{loading === 'discord' ? 'Redirecionando…' : 'Continuar com Discord'}
        </Button>

      </Card>
    </div>
  </main>
}
