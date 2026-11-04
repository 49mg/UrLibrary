import type { BookSummary, CatalogFormat, CatalogResult, ProviderId } from '../../../shared/ipc'
import type { MergedResult } from '../../../shared/discover'
import { useDownloads } from '../stores/downloads'
import { toast } from '../stores/toasts'

export const PROVIDER_SHORT: Record<ProviderId, string> = {
  gutenberg: 'Gutenberg',
  standardebooks: 'Standard Ebooks',
  openlibrary: 'Open Library',
  archive: 'Internet Archive',
  arxiv: 'arXiv'
}

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  la: 'Latin',
  zh: 'Chinese',
  nl: 'Dutch'
}
const THREE_TO_TWO: Record<string, string> = {
  eng: 'en', ara: 'ar', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it',
  por: 'pt', rus: 'ru', lat: 'la', chi: 'zh', zho: 'zh', dut: 'nl', nld: 'nl'
} // prettier-ignore

/** Catalogs use "en", "eng" or "English"; normalize to a two-letter code (or null). */
export function langCode(lang: string | null): string | null {
  if (!lang) return null
  const l = lang.trim().toLowerCase()
  if (l.length === 2) return l
  if (THREE_TO_TWO[l]) return THREE_TO_TWO[l]
  const byName = Object.entries(LANG_NAMES).find(([, name]) => name.toLowerCase() === l)
  return byName ? byName[0] : null
}

export function langName(lang: string | null): string | null {
  const c = langCode(lang)
  return c ? (LANG_NAMES[c] ?? c.toUpperCase()) : lang
}

export const FILTER_LANGUAGES = Object.entries(LANG_NAMES).slice(0, 8)

export function formatBytes(n: number | null | undefined): string {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** The library book downloaded from any of this result's sources, if any. */
export function libraryBookFor(
  m: MergedResult | CatalogResult,
  books: BookSummary[]
): BookSummary | null {
  const sources = 'sources' in m ? m.sources : [m]
  for (const s of sources) {
    const b = books.find((x) => x.source === s.provider && x.sourceId === s.id)
    if (b) return b
  }
  return null
}

/** Starts a download and remembers it for retry; reports "already in library" without a job. */
export async function startDownload(
  source: Pick<CatalogResult, 'provider' | 'id' | 'title'>,
  format: CatalogFormat['format']
): Promise<{ jobId: string | null; existingBookId: string | null } | null> {
  try {
    const r = await window.api.discover.download(source.provider, source.id, format)
    if (r.jobId) {
      useDownloads.getState().remember(r.jobId, {
        provider: source.provider,
        id: source.id,
        format,
        title: source.title
      })
      toast.info(`Downloading “${source.title}”…`)
    } else if (r.existingBookId) {
      toast.info(`“${source.title}” is already in your library.`)
    }
    return r
  } catch (e) {
    toast.error(`Couldn’t download: ${(e as Error).message}`)
    return null
  }
}
