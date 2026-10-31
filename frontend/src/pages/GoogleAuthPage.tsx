import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { apiFetch, restoreSession } from '@/lib/api'
import { setAuthSession, type AuthUser } from '@/lib/auth'
import { consumeGoogleFlow } from '@/lib/google-auth'

export function GoogleAuthPage() {
  const navigate = useNavigate()
  const started = useRef(false)
  const [message, setMessage] = useState('Confirmando autorização Google…')
  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(window.location.hash.slice(1))
    window.history.replaceState(null, '', window.location.pathname)
    void (async () => {
      const state = params.get('state'), code = params.get('code')
      if (!state || !code) throw new Error('A autorização falhou. Inicie novamente.')
      const pending = consumeGoogleFlow(state)
      if (pending.flow === 'connect' && !(await restoreSession())) throw new Error('Entre novamente antes de conectar o Drive.')
      const data = await apiFetch<{ accessToken?: string; user?: AuthUser; status?: string }>('/auth/google/complete', {
        method: 'POST', skipAuth: pending.flow === 'login', retry: false,
        body: JSON.stringify({ state, code, verifier: pending.verifier }),
      })
      if (pending.flow === 'connect') { navigate('/google-connected?status=success', { replace: true }); return }
      if (!data.accessToken || !data.user) throw new Error('Resposta de autenticação inválida.')
      setAuthSession(data.accessToken, data.user)
      navigate('/all-files', { replace: true })
    })().catch(error => setMessage(error instanceof Error ? error.message : 'Falha na autorização.'))
  }, [navigate])
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><Card className="w-full max-w-sm p-6 text-center"><h1 className="text-xl font-bold">Autorização Google</h1><p className="mt-3 text-sm text-slate-600">{message}</p></Card></main>
}
