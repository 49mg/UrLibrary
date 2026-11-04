import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { Sidebar } from './components/Sidebar'
import { Toaster } from './components/Toaster'
import { LibraryPage } from './pages/LibraryPage'
import { AiStudioPage, DiscoverPage, ReaderPage } from './pages/Placeholders'
import { SettingsPage } from './pages/SettingsPage'
import { applyTheme, subscribeSettings, useSettings } from './stores/settings'
import { subscribeJobs } from './stores/jobs'
import { toast } from './stores/toasts'

function App(): React.JSX.Element {
  const theme = useSettings((s) => s.settings.theme)

  useEffect(() => {
    useSettings
      .getState()
      .load()
      .catch((e: Error) => toast.error(`Could not load settings: ${e.message}`))
    const offSettings = subscribeSettings()
    const offJobs = subscribeJobs()
    return () => {
      offSettings()
      offJobs()
    }
  }, [])

  useEffect(() => applyTheme(theme), [theme])

  return (
    <HashRouter>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/reader" element={<ReaderPage />} />
            <Route path="/ai" element={<AiStudioPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <Toaster />
    </HashRouter>
  )
}

export default App
