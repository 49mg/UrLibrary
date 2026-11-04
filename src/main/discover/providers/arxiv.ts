import type { ProviderFactory, ProviderResult, XNode } from '../types'
import { arr, luceneWords, text, xml, yearOf } from '../types'

const API = 'https://export.arxiv.org/api/query'
/** New ids (2301.01234v2) and old ones (hep-th/9901001v1). */
const ID = /^([a-z-]+(\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?$/

function parse(body: string): ProviderResult[] {
  const feed = (xml.parse(body) as XNode).feed as XNode | undefined
  return arr(feed?.entry as XNode[]).flatMap((e) => {
    const id = text(e.id).replace(/^https?:\/\/arxiv\.org\/abs\//, '')
    if (!ID.test(id)) return []
    return [
      {
        key: `arxiv:${id}`,
        provider: 'arxiv' as const,
        id,
        title: text(e.title).replace(/\s+/g, ' '),
        authors: arr(e.author as XNode[])
          .map((a) => text(a.name))
          .filter(Boolean)
          .slice(0, 4),
        year: yearOf(text(e.published)),
        language: 'en',
        coverUrl: null,
        description: text(e.summary).replace(/\s+/g, ' ') || null,
        subjects: arr(e.category as XNode[])
          .map((c) => String(c['@term']))
          .slice(0, 6),
        formats: [{ format: 'pdf' as const, label: 'PDF' }],
        license: 'Free to read on arXiv (author license applies)',
        pageUrl: `https://arxiv.org/abs/${id}`
      }
    ]
  })
}

/** arXiv preprints (science, math, CS). Off by default since it's papers, not books. */
export const arxiv: ProviderFactory = (http) => ({
  id: 'arxiv',
  name: 'arXiv',
  description: 'Free research papers in physics, math, computer science and more.',
  searchable: true,
  allowedHosts: ['arxiv.org'],
  async search(q, signal) {
    const words = luceneWords(q).split(' ').filter(Boolean)
    if (!words.length) return []
    const query = words.map((w) => `all:${w}`).join(' AND ')
    return parse(
      await http.text(
        `${API}?search_query=${encodeURIComponent(query)}&max_results=20&sortBy=relevance`,
        { signal }
      )
    )
  },
  async details(id, signal) {
    if (!ID.test(id)) throw new Error('Invalid arXiv id')
    const [r] = parse(
      await http.text(`${API}?id_list=${encodeURIComponent(id)}`, { signal, maxAgeMs: 24 * 3600e3 })
    )
    if (!r) throw new Error('Paper not found on arXiv')
    return r
  },
  async resolveDownload(id, format) {
    if (!ID.test(id)) throw new Error('Invalid arXiv id')
    if (format !== 'pdf') throw new Error('arXiv papers are offered as PDF')
    return { url: `https://arxiv.org/pdf/${id}` }
  }
})
