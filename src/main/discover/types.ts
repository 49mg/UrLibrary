import { XMLParser } from 'fast-xml-parser'
import type { CatalogFormat, CatalogResult, ProviderId } from '../../shared/ipc'
import type { Http } from './http'

export type ProviderResult = Omit<CatalogResult, 'inLibraryBookId'>

export interface CatalogProvider {
  id: ProviderId
  name: string
  description: string
  searchable: boolean
  /** Download URLs must be on one of these hosts (or their subdomains). */
  allowedHosts: string[]
  search(query: string, signal?: AbortSignal): Promise<ProviderResult[]>
  /** What to show before the user types anything. */
  browse?(signal?: AbortSignal): Promise<ProviderResult[]>
  details(id: string, signal?: AbortSignal): Promise<ProviderResult>
  /** The real file URL for a format, decided in main (never trusted from the renderer). */
  resolveDownload(
    id: string,
    format: CatalogFormat['format'],
    signal?: AbortSignal
  ): Promise<{ url: string }>
}

export type ProviderFactory = (http: Http) => CatalogProvider

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  textNodeName: '#text',
  isArray: (name) => ['entry', 'link', 'author', 'category', 'thumbnail'].includes(name)
})

export type XNode = Record<string, unknown>

export const arr = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

export function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim()
  if (Array.isArray(v)) return v.map(text).join(' ').trim()
  if (typeof v === 'object' && '#text' in (v as XNode)) return text((v as XNode)['#text'])
  return ''
}

/**
 * "Wells, H. G. (Herbert George)" → "H. G. Wells", "Austen, Jane, 1775-1817" → "Jane Austen";
 * leaves "H. G. Wells" alone.
 */
export function displayName(name: string): string {
  const n = name
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    // Library-catalog life dates: "Austen, Jane, 1775-1817", "Doe, John, b. 1901", "1850-"
    .replace(/,?\s*(b\.|d\.|fl\.|ca\.)?\s*\d{3,4}\??-?(\d{3,4})?\??\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '')
    .trim()
  const parts = n.split(',').map((p) => p.trim())
  if (parts.length === 2 && parts[1] && !/^(jr|sr|ii|iii)\.?$/i.test(parts[1]))
    return `${parts[1]} ${parts[0]}`
  return n
}

export function yearOf(v: unknown): number | null {
  const m = String(v ?? '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/)
  return m ? Number(m[1]) : null
}

/** Escapes Lucene query syntax so user text is searched literally. */
export function luceneWords(q: string): string {
  return q
    .split(/\s+/)
    .map((w) => w.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ''))
    .filter(Boolean)
    .slice(0, 10)
    .join(' ')
}
