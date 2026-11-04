import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { Sidebar } from './components/Sidebar'
import { Toaster } from './components/Toaster'
import { LibraryPage } from './pages/LibraryPage'
import { AiStudioPage } from './pages/AiStudioPage'
import { subscribeAi } from './stores/ai'
import { DiscoverPage } from './pages/DiscoverPage'
import { ReaderPage } from './pages/ReaderPage'
import { DropZone } from './components/DropZone'
import { subscribeLibrary, useLibrary } from './stores/library'
import { SettingsPage } from './pages/SettingsPage'
import { NotesPage } from './pages/NotesPage'
import { applyTheme, subscribeSettings, useSettings } from './stores/settings'
import { subscribeJobs } from './stores/jobs'
import { toast } from './stores/toasts'
import { useUi } from './stores/ui'

function App(): React.JSX.Element {
  const theme = useSettings((s) => s.settings.theme)
  const focusMode = useUi((s) => s.focusMode)

  useEffect(() => {
    useSettings
      .getState()
      .load()
      .catch((e: Error) => toast.error(`Could not load settings: ${e.message}`))
    void useLibrary.getState().refresh()
    const offSettings = subscribeSettings()
    const offJobs = subscribeJobs()
    const offLibrary = subscribeLibrary()
    const offAi = subscribeAi()
    return () => {
      offAi()
      offSettings()
      offJobs()
      offLibrary()
    }
  }, [])

  useEffect(() => applyTheme(theme), [theme])

  return (
    <HashRouter>
      <div className="flex h-full">
        {!focusMode && <Sidebar />}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/reader" element={<ReaderPage />} />
            <Route path="/reader/:bookId" element={<ReaderPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/ai" element={<AiStudioPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <Toaster />
      <DropZone />
    </HashRouter>
  )
}

export default App
