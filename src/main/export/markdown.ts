import type { Annotation } from '../../shared/ipc'

interface BookInfo {
  title: string
  author: string | null
}

/** Prefixes every line so multi-line text stays inside the blockquote. */
const quote = (s: string): string =>
  s
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n')

function where(a: Annotation): string {
  const m = a.location.match(/^page:(\d+)$/)
  return m ? ` (p. ${m[1]})` : ''
}

/**
 * Notes for one book as Markdown: highlights grouped by chapter in reading order, with their notes,
 * then bookmarks, then the free-form notebook.
 */
export function annotationsToMarkdown(
  book: BookInfo,
  annotations: Annotation[],
  notebook: string,
  exportedAt = new Date()
): string {
  const out: string[] = [`# ${book.title}`]
  if (book.author) out.push(`*${book.author}*`)
  out.push(`Notes exported from Ur Library on ${exportedAt.toISOString().slice(0, 10)}.`)

  const highlights = annotations
    .filter((a) => a.type === 'highlight')
    .sort((a, b) => a.sortKey - b.sortKey)
  if (highlights.length) {
    out.push('## Highlights')
    let chapter: string | null | undefined
    for (const h of highlights) {
      if (h.chapter !== chapter) {
        chapter = h.chapter
        if (chapter) out.push(`### ${chapter}`)
      }
      const parts = [quote(h.text ?? '') + where(h)]
      if (h.note) parts.push(h.note.trim())
      out.push(parts.join('\n\n'))
    }
  }

  const bookmarks = annotations
    .filter((a) => a.type === 'bookmark')
    .sort((a, b) => a.sortKey - b.sortKey)
  if (bookmarks.length) {
    out.push('## Bookmarks')
    out.push(
      bookmarks
        .map((b) => `- ${b.chapter || 'Bookmark'}${where(b)} — ${Math.round(b.sortKey * 100)}%`)
        .join('\n')
    )
  }

  if (notebook.trim()) {
    out.push('## Notebook')
    out.push(notebook.trim())
  }

  if (!highlights.length && !bookmarks.length && !notebook.trim()) {
    out.push('_No highlights or notes yet._')
  }
  return out.join('\n\n') + '\n'
}
