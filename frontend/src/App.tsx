import { useEffect, useRef, useState } from 'react'
import { restoreSession } from '@/lib/api'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DriveLayout } from '@/layouts/DriveLayout'
import { AllFilesPage } from '@/pages/AllFilesPage'
import { ArchivedPage } from '@/pages/ArchivedPage'
import { LoginPage } from '@/pages/LoginPage'
import { GoogleAuthPage } from '@/pages/GoogleAuthPage'
import { GoogleConnectedPage } from '@/pages/GoogleConnectedPage'
import { QuotaTrackerPage } from '@/pages/QuotaTrackerPage'
import { RecentPage } from '@/pages/RecentPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SharedPage } from '@/pages/SharedPage'
import { StarredPage } from '@/pages/StarredPage'
import { PublicFilePage } from '@/pages/PublicFilePage'
import { ApiManagementPage } from '@/pages/ApiManagementPage'
import { TrashPage } from '@/pages/TrashPage'
import { ActivityLogPage } from '@/pages/ActivityLogPage'
import { UploadProvider } from '@/context/UploadContext'


function App() {
  const [ready, setReady] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [waitingSeconds, setWaitingSeconds] = useState(0)
  const started = useRef(false)
  async function initializeSession() {
    setSessionError('')
    setWaitingSeconds(0)
    try { await restoreSession(); setReady(true) }
    catch (error) { setSessionError(error instanceof Error ? error.message : 'Servidor temporariamente indisponível.') }
  }
  useEffect(() => {
    if (started.current) return
    started.current = true
    void initializeSession()
  }, [])
  useEffect(() => {
    if (ready || sessionError) return
    const timer = window.setInterval(() => setWaitingSeconds(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [ready, sessionError])
  if (sessionError) return <main className="p-6"><p>{sessionError}</p><button className="mt-4 underline" onClick={() => void initializeSession()}>Tentar novamente</button></main>
  if (!ready) return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" role="status" aria-live="polite">
        <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600" aria-hidden="true" />
        <h1 className="text-xl font-bold">{waitingSeconds < 8 ? 'Abrindo seu SingleDrive…' : 'Aguardando o servidor…'}</h1>
        <p className="mt-3 text-sm text-slate-600">{waitingSeconds < 8 ? 'Verificando sua sessão com segurança.' : 'Após um período sem uso, a hospedagem pode precisar iniciar novamente. Sua sessão não será apagada durante a espera.'}</p>
        {waitingSeconds >= 90 ? <p className="mt-4 text-sm text-slate-600">Está demorando mais que o esperado. Você pode continuar aguardando ou recarregar a página para tentar novamente.</p> : null}
      </div>
    </main>
  )
  return (
    <UploadProvider>
      <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="google-auth" element={<GoogleAuthPage />} />
      <Route path="google-connected" element={<GoogleConnectedPage />} />
      <Route path="public/files/:token" element={<PublicFilePage />} />
      <Route path="public/files/:token/embed" element={<PublicFilePage embed />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DriveLayout />}>
          <Route index element={<Navigate to="/all-files" replace />} />
          <Route path="all-files" element={<AllFilesPage />} />
          <Route path="quota" element={<QuotaTrackerPage />} />
          <Route path="shared" element={<SharedPage />} />
          <Route path="recent" element={<RecentPage />} />
          <Route path="starred" element={<StarredPage />} />
          <Route path="archived" element={<ArchivedPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="activity" element={<ActivityLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="api" element={<ApiManagementPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/all-files" replace />} />
      </Routes>
    </UploadProvider>
  )
}


export default App
