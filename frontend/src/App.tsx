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
  const started = useRef(false)
  async function initializeSession() {
    setSessionError('')
    try { await restoreSession(); setReady(true) }
    catch (error) { setSessionError(error instanceof Error ? error.message : 'Servidor temporariamente indisponível.') }
  }
  useEffect(() => {
    if (started.current) return
    started.current = true
    void initializeSession()
  }, [])
  if (sessionError) return <main className="p-6"><p>{sessionError}</p><button className="mt-4 underline" onClick={() => void initializeSession()}>Tentar novamente</button></main>
  if (!ready) return <main className="p-6">Carregando…</main>
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
