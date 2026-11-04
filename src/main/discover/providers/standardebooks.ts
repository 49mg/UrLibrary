import type { ProviderFactory, ProviderResult, XNode } from '../types'
import { arr, text, xml } from '../types'
import { normalizeTitle } from '../../../shared/discover'

const BASE = 'https://standardebooks.org'
const FEED = `${BASE}/feeds/atom/new-releases`
const SLUG = /^[a-z0-9-]+(\/[a-z0-9-]+)+$/

/**
 * Standard Ebooks: beautifully proofread public-domain EPUBs. Their full catalog feed needs a paid
 * membership, so we use the free "new releases" feed (latest 15) and match searches against it.
 */
export const standardebooks: ProviderFactory = (http) => {
  const entries = async (signal?: AbortSignal): Promise<ProviderResult[]> => {
    const feed = (xml.parse(await http.text(FEED, { signal })) as XNode).feed as XNode | undefined
    return arr(feed?.entry as XNode[]).flatMap((e) => {
      const id = text(e.id).replace(`${BASE}/ebooks/`, '')
      if (!SLUG.test(id)) return []
      const epub = arr(e.link as XNode[]).find(
        (l) => l['@rel'] === 'enclosure' && String(l['@title']).startsWith('Recommended')
      )
      const thumb = arr(e.thumbnail as XNode[])[0]
      return [
        {
          key: `standardebooks:${id}`,
          provider: 'standardebooks' as const,
          id,
          title: text(e.title),
          authors: arr(e.author as XNode[])
            .map((a) => text(a.name))
            .filter(Boolean),
          year: null,
          language: 'en',
          coverUrl: thumb ? String(thumb['@url']) : null,
          description: text(e.summary) || null,
          subjects: arr(e.category as XNode[])
            .filter((c) => String(c['@scheme']).endsWith('LCSH'))
            .map((c) => String(c['@term'])),
          formats: [
            {
              format: 'epub' as const,
              label: 'EPUB',
              sizeBytes: epub ? Number(epub['@length']) || null : null
            }
          ],
          license: text(e.rights).split('. ')[0] || 'Public domain in the United States',
          pageUrl: `${BASE}/ebooks/${id}`
        }
      ]
    })
  }

  return {
    id: 'standardebooks',
    name: 'Standard Ebooks',
    description:
      'Hand-proofread, beautifully typeset classics. Only the newest releases are listed.',
    searchable: false,
    allowedHosts: ['standardebooks.org'],
    browse: entries,
    async search(q, signal) {
      const words = normalizeTitle(q).split(' ').filter(Boolean)
      if (!words.length) return []
      return (await entries(signal)).filter((r) => {
        const hay = normalizeTitle(`${r.title} ${r.authors.join(' ')}`)
        return words.every((w) => hay.includes(w))
      })
    },
    async details(id, signal) {
      const hit = (await entries(signal)).find((r) => r.id === id)
      if (!hit) throw new Error('This book is no longer in the Standard Ebooks new-releases feed')
      return hit
    },
    async resolveDownload(id, format) {
      if (!SLUG.test(id)) throw new Error('Invalid Standard Ebooks id')
      if (format !== 'epub') throw new Error('Standard Ebooks are offered as EPUB')
      // `?source=feed` gets the file itself instead of the download landing page.
      return { url: `${BASE}/ebooks/${id}/downloads/${id.replace(/\//g, '_')}.epub?source=feed` }
    }
  }
}
