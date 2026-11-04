import type { CatalogFormat } from '../../../shared/ipc'
import type { ProviderFactory, ProviderResult, XNode } from '../types'
import { arr, displayName, text, xml } from '../types'

const BASE = 'https://www.gutenberg.org'
const LICENSE = 'Public domain in the USA (Project Gutenberg)'

function idFromEntry(e: XNode): string | null {
  const m = text(e.id).match(/\/ebooks\/(\d+)\.opds$/)
  return m ? m[1] : null
}

function base(id: string, title: string, authors: string[]): ProviderResult {
  return {
    key: `gutenberg:${id}`,
    provider: 'gutenberg',
    id,
    title,
    authors,
    year: null, // Gutenberg's dates are release dates, not publication years
    language: null,
    coverUrl: `${BASE}/cache/epub/${id}/pg${id}.cover.medium.jpg`,
    description: null,
    subjects: [],
    formats: [{ format: 'epub', label: 'EPUB' }],
    license: LICENSE,
    pageUrl: `${BASE}/ebooks/${id}`
  }
}

/** Official Project Gutenberg OPDS catalog (fast and reliable; no API key). */
export const gutenberg: ProviderFactory = (http) => {
  const list = async (url: string, signal?: AbortSignal): Promise<ProviderResult[]> => {
    const feed = (xml.parse(await http.text(url, { signal })) as XNode).feed as XNode | undefined
    const out: ProviderResult[] = []
    for (const e of arr(feed?.entry as XNode[])) {
      const id = idFromEntry(e) // skips navigation entries like "Sort by title"
      if (!id) continue
      // In search feeds the author is the entry's <content>.
      const author = text(e.content)
      out.push(base(id, text(e.title), author ? [author] : []))
    }
    return out
  }

  return {
    id: 'gutenberg',
    name: 'Project Gutenberg',
    description: '75,000+ free public-domain ebooks, mostly classics, carefully transcribed.',
    searchable: true,
    allowedHosts: ['gutenberg.org'],
    search: (q, signal) =>
      list(`${BASE}/ebooks/search.opds/?query=${encodeURIComponent(q)}`, signal),
    browse: (signal) => list(`${BASE}/ebooks/search.opds/?sort_order=downloads`, signal),
    async details(id, signal) {
      if (!/^\d+$/.test(id)) throw new Error('Invalid Gutenberg id')
      const feed = (
        xml.parse(
          await http.text(`${BASE}/ebooks/${id}.opds`, { signal, maxAgeMs: 24 * 3600e3 })
        ) as XNode
      ).feed as XNode
      // The book feed has one entry per edition (urn:gutenberg:<id>:<n>); prefer the one with images.
      const editions = arr(feed.entry as XNode[]).filter((x) =>
        new RegExp(`^urn:gutenberg:${id}:\\d+$`).test(text(x.id))
      )
      const hasImages = (x: XNode): boolean =>
        arr(x.link as XNode[]).some((l) => String(l['@href']).endsWith('.epub3.images'))
      const e = editions.find(hasImages) ?? editions[0]
      if (!e) throw new Error('Book not found on Project Gutenberg')
      const authors = arr(e.author as XNode[])
        .map((a) => displayName(text(a.name)))
        .filter(Boolean)
      const r = base(id, text(e.title), authors)
      r.language = text(e.language) || null
      r.subjects = arr(e.category as XNode[])
        .filter((c) => String(c['@scheme']).endsWith('LCSH'))
        .map((c) => String(c['@term']))
        .slice(0, 8)
      const epub = arr(e.link as XNode[]).find((l) => String(l['@href']).endsWith('.epub3.images'))
      const size = epub ? Number(epub['@length']) || null : null
      r.formats = [
        { format: 'epub', label: 'EPUB with images', sizeBytes: size } satisfies CatalogFormat
      ]
      r.license = text(e.rights) || LICENSE
      return r
    },
    async resolveDownload(id, format) {
      if (!/^\d+$/.test(id)) throw new Error('Invalid Gutenberg id')
      if (format !== 'epub') throw new Error('Project Gutenberg books are offered as EPUB')
      return { url: `${BASE}/ebooks/${id}.epub3.images` }
    }
  }
}
