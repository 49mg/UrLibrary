import type { AppSettings, DeepPartial, ReaderPrefs } from './ipc'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  reader: {
    theme: 'light',
    fontFamily: 'serif',
    fontSize: 18,
    lineHeight: 1.6
  },
  ai: {
    effort: 'medium',
    targetLanguage: 'English'
  }
}

/** Reader settings not exposed on the Settings page; defaults for every book. */
export const DEFAULT_READER_EXTRAS: Pick<ReaderPrefs, 'flow' | 'pdfZoom'> = {
  flow: 'paginated',
  pdfZoom: 'page-width'
}

/** App-wide reader defaults overlaid with a book's own overrides. */
export function effectiveReaderPrefs(
  defaults: AppSettings['reader'],
  overrides: Partial<ReaderPrefs> | null | undefined
): ReaderPrefs {
  return { ...defaults, ...DEFAULT_READER_EXTRAS, ...(overrides ?? {}) }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Recursively merges `patch` into `base` without mutating either. Unknown keys are dropped. */
export function mergeSettings<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isPlainObject(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const key of Object.keys(out)) {
    const pv = (patch as Record<string, unknown>)[key]
    if (pv === undefined) continue
    const bv = out[key]
    out[key] = isPlainObject(bv) ? mergeSettings(bv, pv as DeepPartial<typeof bv>) : pv
  }
  return out as T
}
