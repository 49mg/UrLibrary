import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, tone = 'info') => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, tone, message }].slice(-4) })
    setTimeout(() => get().dismiss(id), tone === 'error' ? 7000 : 4000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const toast = {
  info: (m: string) => useToasts.getState().push(m, 'info'),
  success: (m: string) => useToasts.getState().push(m, 'success'),
  error: (m: string) => useToasts.getState().push(m, 'error')
}
