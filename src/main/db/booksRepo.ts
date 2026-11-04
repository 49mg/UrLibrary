import type { Db } from './index'
import type { BookFormat, BookSummary } from '../../shared/ipc'
import { coverUrl } from '../services/fileStore'

interface BookRow {
  id: string
  title: string
  author: string | null
  format: BookFormat
  source: string
  cover_path: string | null
  added_at: string
  progress: number
}

export class BooksRepo {
  constructor(private db: Db) {}

  list(): BookSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, author, format, source, cover_path, added_at, progress
         FROM books ORDER BY COALESCE(last_opened_at, added_at) DESC`
      )
      .all() as unknown as BookRow[]
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author,
      format: r.format,
      source: r.source,
      coverUrl: r.cover_path ? coverUrl(r.id, r.cover_path) : null,
      addedAt: r.added_at,
      progress: r.progress
    }))
  }
}
