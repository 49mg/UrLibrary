import type { CatalogResult, ProviderId } from './ipc'

/** A book as shown in Discover: one entry, possibly offered by several sources. */
export interface MergedResult {
  key: string
  title: string
  authors: string[]
  year: number | null
  language: string | null
  coverUrl: string | null
  /** Best source first. */
  sources: CatalogResult[]
  inLibraryBookId: string | null
}

/** Sources ordered by how clean their files usually are (proofread EPUBs before scans). */
export const PROVIDER_RANK: Record<ProviderId, number> = {
  standardebooks: 0,
  gutenberg: 1,
  openlibrary: 2,
  archive: 3,
  arxiv: 4
}

const ARTICLES = /^(the|a|an|le|la|les|el|los|las|der|die|das)\s+/

/** "The Time Machine: An Invention" and "time machine" → "time machine". */
export function normalizeTitle(t: string): string {
  return t
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s*[:;(]|\s+[-–—]\s+/)[0]
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ARTICLES, '')
}

/** Last name of the first author, normalized ("Wells, H. G." and "H. G. Wells" → "wells"). */
export function authorKey(authors: string[]): string {
  const a = authors[0]
  if (!a) return ''
  const name = a.includes(',') ? a.split(',')[0] : a.trim().split(/\s+/).pop()!
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Groups results that are the same book (same normalized title + first author's last name),
 * keeping every source's download options. Order follows first appearance, so the caller's
 * ranking (e.g. relevance) is preserved.
 */
export function mergeResults(results: CatalogResult[]): MergedResult[] {
  const groups = new Map<string, MergedResult>()
  for (const r of results) {
    const k = `${normalizeTitle(r.title)}|${authorKey(r.authors)}`
    const g = groups.get(k)
    if (!g) {
      groups.set(k, {
        key: r.key,
        title: r.title,
        authors: r.authors,
        year: r.year,
        language: r.language,
        coverUrl: r.coverUrl,
        sources: [r],
        inLibraryBookId: r.inLibraryBookId
      })
      continue
    }
    g.sources.push(r)
    g.sources.sort((a, b) => PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider])
    // Fill gaps from other sources; the best-ranked source wins the title.
    const best = g.sources[0]
    g.title = best.title
    g.authors = best.authors.length ? best.authors : g.authors
    g.year = g.year ?? r.year
    g.language = g.language ?? r.language
    g.coverUrl = best.coverUrl ?? g.coverUrl ?? r.coverUrl
    g.inLibraryBookId = g.inLibraryBookId ?? r.inLibraryBookId
  }
  return [...groups.values()]
}
