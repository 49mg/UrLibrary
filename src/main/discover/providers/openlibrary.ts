import type { ProviderFactory, ProviderResult } from '../types'
import { arr } from '../types'
import { archiveDownloadUrl, formatsOf, openItem } from './archive'
import type { Http } from '../http'
import type { CatalogFormat } from '../../../shared/ipc'
import { cleanText } from '../../import/textUtils'

const BASE = 'https://openlibrary.org'
const WORK = /^OL\d+W$/

interface Doc {
  key: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  language?: string[]
  cover_i?: number
  ia?: string[]
  subject?: string[]
}

const FIELDS = 'key,title,author_name,first_publish_year,language,cover_i,ia,subject'

function toResult(d: Doc): ProviderResult | null {
  const id = d.key.replace('/works/', '')
  if (!WORK.test(id)) return null
  return {
    key: `openlibrary:${id}`,
    provider: 'openlibrary',
    id,
    title: d.title ?? 'Untitled',
    authors: (d.author_name ?? []).slice(0, 3),
    year: d.first_publish_year ?? null,
    language: d.language?.[0] ?? null,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    description: null,
    subjects: (d.subject ?? []).slice(0, 8),
    formats: [], // which scan is downloadable is only known after checking archive.org (details)
    license: 'Public domain scan',
    pageUrl: `${BASE}/works/${id}`
  }
}

/** The first of a work's archive.org scans that can actually be downloaded. */
async function downloadableScan(http: Http, id: string, signal?: AbortSignal): Promise<string> {
  const data = await http.json<{ docs?: Doc[] }>(
    `${BASE}/search.json?q=${encodeURIComponent(`key:"/works/${id}"`)}&fields=ia`,
    { signal, maxAgeMs: 24 * 3600e3 }
  )
  const scans = data.docs?.[0]?.ia ?? []
  for (const ia of scans.slice(0, 8)) {
    try {
      const md = await openItem(http, ia, signal)
      if (formatsOf(md.files).length) return ia
    } catch {
      // borrow-only or missing — try the next scan
    }
  }
  throw new Error('None of this book’s scans can be downloaded freely')
}

/** Open Library: good metadata and covers; files come from public scans on archive.org. */
export const openlibrary: ProviderFactory = (http) => ({
  id: 'openlibrary',
  name: 'Open Library',
  description:
    'Catalog of public-domain scans with good covers and metadata (files from archive.org).',
  searchable: true,
  allowedHosts: ['archive.org'],
  async search(q, signal) {
    const params = new URLSearchParams({ q, public_scan_b: 'true', fields: FIELDS, limit: '24' })
    const data = await http.json<{ docs?: Doc[] }>(`${BASE}/search.json?${params}`, { signal })
    return (data.docs ?? []).map(toResult).filter((r): r is ProviderResult => !!r)
  },
  async details(id, signal) {
    if (!WORK.test(id)) throw new Error('Invalid Open Library id')
    const [search, work] = await Promise.all([
      http.json<{ docs?: Doc[] }>(
        `${BASE}/search.json?q=${encodeURIComponent(`key:"/works/${id}"`)}&fields=${FIELDS}`,
        { signal, maxAgeMs: 24 * 3600e3 }
      ),
      http.json<{ description?: string | { value?: string }; subjects?: string[] }>(
        `${BASE}/works/${id}.json`,
        {
          signal,
          maxAgeMs: 24 * 3600e3
        }
      )
    ])
    const doc = search.docs?.[0]
    const r = doc ? toResult(doc) : null
    if (!r) throw new Error('Book not found on Open Library')
    const desc = typeof work.description === 'string' ? work.description : work.description?.value
    r.description = desc ? cleanText(desc.replace(/\r?\n+/g, ' ')).slice(0, 1500) : null
    r.subjects = arr(work.subjects).slice(0, 8)
    const ia = await downloadableScan(http, id, signal)
    r.formats = formatsOf((await openItem(http, ia, signal)).files)
    return r
  },
  async resolveDownload(id, format: CatalogFormat['format'], signal) {
    if (!WORK.test(id)) throw new Error('Invalid Open Library id')
    return archiveDownloadUrl(http, await downloadableScan(http, id, signal), format, signal)
  }
})
