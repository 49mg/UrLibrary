import type { Db } from './index'
import type { SearchHit } from '../../shared/ipc'
import { SNIPPET_END, SNIPPET_START } from '../../shared/ipc'

/**
 * Turns free text into a safe FTS5 query: every word becomes a quoted phrase (so operators and
 * punctuation in user input can't break the syntax), all words must match, and the last word
 * matches as a prefix so results update while typing.
 */
export function toFtsQuery(input: string): string | null {
  const words = input
    .normalize('NFKC')
    .split(/[\s"]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'_-]/gu, ''))
    .filter((w) => w.length > 0)
    .slice(0, 12)
  if (words.length === 0) return null
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' ')
}

export class SearchRepo {
  constructor(private db: Db) {}

  /** Book ids whose title or author contain the text (case-insensitive). */
  matchBookIds(input: string, limit = 20): string[] {
    const q = `%${input.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    return (
      this.db
        .prepare(
          `SELECT id FROM books WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\'
           ORDER BY title COLLATE NOCASE LIMIT ?`
        )
        .all(q, q, limit) as Array<{ id: string }>
    ).map((r) => r.id)
  }

  fullText(input: string, limit = 50): SearchHit[] {
    const query = toFtsQuery(input)
    if (!query) return []
    const rows = this.db
      .prepare(
        `SELECT t.book_id, b.title AS book_title, t.chunk_id, t.chapter, t.location,
           snippet(book_text, 4, ?, ?, '…', 24) AS snippet
         FROM book_text t JOIN books b ON b.id = t.book_id
         WHERE book_text MATCH ?
         ORDER BY bm25(book_text) LIMIT ?`
      )
      .all(SNIPPET_START, SNIPPET_END, query, limit) as Array<{
      book_id: string
      book_title: string
      chunk_id: string
      chapter: string | null
      location: string
      snippet: string
    }>
    return rows.map((r) => ({
      bookId: r.book_id,
      bookTitle: r.book_title,
      chunkId: r.chunk_id,
      chapter: r.chapter,
      location: r.location,
      snippet: r.snippet
    }))
  }
}
