import { create } from 'zustand'
import type { BookFormat, ReadingStatus } from '../../../shared/ipc'

export type SortKey = 'recent' | 'title' | 'author' | 'added'
export type ViewMode = 'grid' | 'list'

interface ViewPrefs {
  view: ViewMode
  sort: SortKey
  format: BookFormat | 'all'
  status: ReadingStatus | 'all'
  source: 'all' | 'local' | 'online'
  set: (p: Partial<Omit<ViewPrefs, 'set'>>) => void
}

const KEY = 'sl.viewPrefs'
const DEFAULTS = {
  view: 'grid',
  sort: 'recent',
  format: 'all',
  status: 'all',
  source: 'all'
} as const

function load(): Partial<ViewPrefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ViewPrefs>
  } catch {
    return {}
  }
}

/** Per-device library view preferences (layout, sort, filters). Losing them is harmless. */
export const useViewPrefs = create<ViewPrefs>((set, get) => ({
  ...DEFAULTS,
  ...load(),
  set: (p) => {
    set(p)
    try {
      const { view, sort, format, status, source } = get()
      localStorage.setItem(KEY, JSON.stringify({ view, sort, format, status, source }))
    } catch {
      // storage unavailable — keep in memory only
    }
  }
}))
