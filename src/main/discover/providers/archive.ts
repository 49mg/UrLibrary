import type { CatalogFormat } from '../../../shared/ipc'
import type { Http } from '../http'
import type { ProviderFactory, ProviderResult } from '../types'
import { arr, displayName, luceneWords, yearOf } from '../types'
import { htmlToText } from '../../import/html'
import { cleanText } from '../../import/textUtils'

const BASE = 'https://archive.org'
const ID = /^[A-Za-z0-9._-]{1,100}$/
/** Works published in 1930 or earlier are public domain in the US as of 2026. */
export const PD_CUTOFF_YEAR = 1930

interface SearchDoc {
  identifier: string
  title?: string | string[]
  creator?: string | string[]
  year?: number | string
  language?: string | string[]
  licenseurl?: string
  format?: string[]
  description?: string | string[]
}

interface Metadata {
  metadata?: {
    title?: string | string[]
    creator?: string | string[]
    year?: string
    date?: string
    language?: string | string[]
    licenseurl?: string
    description?: string | string[]
    subject?: string | string[]
    'access-restricted-item'?: string | boolean
  }
  files?: Array<{ name: string; format?: string; size?: string }>
  is_dark?: boolean
}

const first = (v: string | string[] | undefined): string => cleanText(arr(v)[0] ?? '')

export function licenseLabel(licenseurl: string | undefined, year: number | null): string | null {
  if (licenseurl) {
    if (/publicdomain/i.test(licenseurl)) return 'Public domain (dedicated)'
    const m = licenseurl.match(/licenses\/([a-z-]+)\/([\d.]+)/i)
    return m ? `Creative Commons ${m[1].toUpperCase()} ${m[2]}` : 'Openly licensed'
  }
  if (year && year <= PD_CUTOFF_YEAR) return `Public domain in the USA (published ${year})`
  return null
}

function pickFile(
  files: Metadata['files'],
  format: CatalogFormat['format']
): { name: string; size: number | null } | null {
  const list = files ?? []
  const f =
    format === 'epub'
      ? list.find((x) => x.name.toLowerCase().endsWith('.epub'))
      : (list.find((x) => x.format === 'Text PDF') ??
        list.find((x) => x.name.toLowerCase().endsWith('.pdf')))
  return f ? { name: f.name, size: Number(f.size) || null } : null
}

/** Metadata for an item that may be downloaded, or an error explaining why not. */
export async function openItem(
  http: Http,
  id: string,
  signal?: AbortSignal
): Promise<Required<Pick<Metadata, 'files'>> & Metadata> {
  if (!ID.test(id)) throw new Error('Invalid archive.org identifier')
  const md = await http.json<Metadata>(`${BASE}/metadata/${encodeURIComponent(id)}`, {
    signal,
    maxAgeMs: 24 * 3600e3
  })
  if (!md.metadata || md.is_dark) throw new Error('This item is not available on archive.org')
  const restricted = md.metadata['access-restricted-item']
  if (restricted === true || restricted === 'true')
    throw new Error('This item can only be borrowed, not downloaded')
  const year = yearOf(md.metadata.year ?? md.metadata.date)
  if (!licenseLabel(md.metadata.licenseurl, year)) {
    throw new Error(
      'This item isn’t public domain or openly licensed, so it isn’t offered for download'
    )
  }
  return { ...md, files: md.files ?? [] }
}

export function formatsOf(files: Metadata['files']): CatalogFormat[] {
  const out: CatalogFormat[] = []
  const epub = pickFile(files, 'epub')
  if (epub) out.push({ format: 'epub', label: 'EPUB (from scan)', sizeBytes: epub.size })
  const pdf = pickFile(files, 'pdf')
  if (pdf) out.push({ format: 'pdf', label: 'PDF (scanned pages)', sizeBytes: pdf.size })
  return out
}

export async function archiveDownloadUrl(
  http: Http,
  id: string,
  format: CatalogFormat['format'],
  signal?: AbortSignal
): Promise<{ url: string }> {
  const md = await openItem(http, id, signal)
  const f = pickFile(md.files, format)
  if (!f) throw new Error(`No ${format.toUpperCase()} file for this item`)
  return {
    url: `${BASE}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`
  }
}

/**
 * Internet Archive texts, limited to public-domain (≤1930) or openly licensed items that can be
 * downloaded (no lending-library or print-disabled items).
 */
export const archive: ProviderFactory = (http) => ({
  id: 'archive',
  name: 'Internet Archive',
  description: 'Millions of scanned books. Only public-domain and openly licensed items are shown.',
  searchable: true,
  allowedHosts: ['archive.org'],
  async search(q, signal) {
    const words = luceneWords(q)
    if (!words) return []
    const query = [
      `(title:(${words}) OR creator:(${words}))`,
      'mediatype:texts',
      '(format:EPUB OR format:"Text PDF")',
      `(licenseurl:* OR year:[* TO ${PD_CUTOFF_YEAR}])`,
      'NOT collection:inlibrary',
      'NOT collection:printdisabled',
      'NOT access-restricted-item:true'
    ].join(' AND ')
    const params = new URLSearchParams({ q: query, rows: '24', output: 'json' })
    for (const f of [
      'identifier',
      'title',
      'creator',
      'year',
      'language',
      'licenseurl',
      'format',
      'description'
    ]) {
      params.append('fl[]', f)
    }
    params.append('sort[]', 'downloads desc')
    const data = await http.json<{ response?: { docs?: SearchDoc[] } }>(
      `${BASE}/advancedsearch.php?${params}`,
      { signal }
    )
    return (data.response?.docs ?? []).flatMap((d): ProviderResult[] => {
      const year = yearOf(d.year)
      const license = licenseLabel(d.licenseurl, year)
      if (!license || !ID.test(d.identifier)) return []
      const formats: CatalogFormat[] = []
      if (d.format?.includes('EPUB')) formats.push({ format: 'epub', label: 'EPUB (from scan)' })
      if (d.format?.includes('Text PDF'))
        formats.push({ format: 'pdf', label: 'PDF (scanned pages)' })
      const desc = first(d.description)
      return [
        {
          key: `archive:${d.identifier}`,
          provider: 'archive',
          id: d.identifier,
          title: first(d.title) || d.identifier,
          authors: arr(d.creator)
            .map((c) => displayName(cleanText(c)))
            .filter(Boolean)
            .slice(0, 3),
          year,
          language: first(d.language) || null,
          coverUrl: `${BASE}/services/img/${encodeURIComponent(d.identifier)}`,
          description: desc ? cleanText(htmlToText(desc)).slice(0, 600) : null,
          subjects: [],
          formats,
          license,
          pageUrl: `${BASE}/details/${encodeURIComponent(d.identifier)}`
        }
      ]
    })
  },
  async details(id, signal) {
    const md = await openItem(http, id, signal)
    const m = md.metadata!
    const year = yearOf(m.year ?? m.date)
    const desc = arr(m.description).join('\n\n')
    return {
      key: `archive:${id}`,
      provider: 'archive',
      id,
      title: first(m.title) || id,
      authors: arr(m.creator)
        .map((c) => displayName(cleanText(c)))
        .filter(Boolean)
        .slice(0, 3),
      year,
      language: first(m.language) || null,
      coverUrl: `${BASE}/services/img/${encodeURIComponent(id)}`,
      description: desc ? cleanText(htmlToText(desc)).slice(0, 1500) : null,
      subjects: arr(m.subject).map(cleanText).filter(Boolean).slice(0, 8),
      formats: formatsOf(md.files),
      license: licenseLabel(m.licenseurl, year) as string,
      pageUrl: `${BASE}/details/${encodeURIComponent(id)}`
    }
  },
  resolveDownload: (id, format, signal) => archiveDownloadUrl(http, id, format, signal)
})
