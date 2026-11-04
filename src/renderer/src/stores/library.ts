import { create } from 'zustand'
import type { BookSummary, Collection } from '../../../shared/ipc'
import { toast } from './toasts'

interface LibraryState {
  books: BookSummary[]
  collections: Collection[]
  loaded: boolean
  refresh: () => Promise<void>
}

export const useLibrary = create<LibraryState>((set) => ({
  books: [],
  collections: [],
  loaded: false,
  refresh: async () => {
    try {
      const [books, collections] = await Promise.all([
        window.api.books.list(),
        window.api.collections.list()
      ])
      set({ books, collections, loaded: true })
    } catch (e) {
      toast.error(`Could not load library: ${(e as Error).message}`)
      set({ loaded: true })
    }
  }
}))

/** Refetches on 'library:changed', coalescing bursts (e.g. bulk imports) into one refresh. */
export function subscribeLibrary(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const off = window.api.on('library:changed', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void useLibrary.getState().refresh(), 150)
  })
  return () => {
    off()
    if (timer) clearTimeout(timer)
  }
}
