import { create } from 'zustand'

interface UiState {
  /** Hides the app sidebar and reader chrome for distraction-free reading. */
  focusMode: boolean
  setFocusMode: (on: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  focusMode: false,
  setFocusMode: (focusMode) => {
    set({ focusMode })
    try {
      if (focusMode && !document.fullscreenElement)
        void document.documentElement.requestFullscreen()
      if (!focusMode && document.fullscreenElement) void document.exitFullscreen()
    } catch {
      // Fullscreen can be refused; focus mode still hides the chrome.
    }
  }
}))
