import { create } from 'zustand'
import type { AppSettings, DeepPartial } from '../../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: DeepPartial<AppSettings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => set({ settings: await window.api.settings.get(), loaded: true }),
  update: async (patch) => set({ settings: await window.api.settings.update(patch) })
}))

export function subscribeSettings(): () => void {
  return window.api.on('settings:changed', (settings) => useSettings.setState({ settings }))
}

/** Keeps the `dark` class on <html> in sync with the preference and the OS theme. */
export function applyTheme(pref: AppSettings['theme']): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    const dark = pref === 'dark' || (pref === 'system' && mq.matches)
    document.documentElement.classList.toggle('dark', dark)
  }
  apply()
  mq.addEventListener('change', apply)
  return () => mq.removeEventListener('change', apply)
}
