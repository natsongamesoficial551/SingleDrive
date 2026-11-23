import { useState } from 'react'
import { startGoogleAuth } from '@/lib/google-auth'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { AuthStory } from '@/components/auth/AuthStory'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function LoginPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function continueWithGoogle() {
    setLoading(true)
    setError('')
    try { await startGoogleAuth('login') }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o acesso com Google.')
      setLoading(false)
    }
  }

  return <main className="sd-auth">
    <AuthStory />
    <div className="sd-auth-form">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-11 w-11" />
          <div><h1 className="text-2xl font-extrabold">Entre no SingleDrive</h1><p className="text-sm text-slate-500">Use sua conta Google para entrar ou criar seu perfil.</p></div>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <Button className="mt-6 w-full" variant="outline" disabled={loading} onClick={() => void continueWithGoogle()}>
          <GoogleLogo />{loading ? 'Redirecionando…' : 'Continuar com Google'}
        </Button>
      </Card>
    </div>
  </main>
}
