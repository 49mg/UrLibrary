import { randomUUID } from 'node:crypto'
import type { Db } from './index'
import type { Collection } from '../../shared/ipc'
import { AppError } from '../ipc/handler'

export class CollectionsRepo {
  constructor(private db: Db) {}

  list(): Collection[] {
    return (
      this.db
        .prepare(
          `SELECT c.id, c.name, COUNT(bc.book_id) AS bookCount
           FROM collections c LEFT JOIN book_collections bc ON bc.collection_id = c.id
           GROUP BY c.id ORDER BY c.name COLLATE NOCASE`
        )
        .all() as unknown as Collection[]
    ).map((c) => ({ ...c, bookCount: Number(c.bookCount) }))
  }

  create(name: string): Collection {
    const id = randomUUID()
    try {
      this.db.prepare('INSERT INTO collections (id, name) VALUES (?, ?)').run(id, name.trim())
    } catch {
      throw new AppError('DUPLICATE', `A collection named "${name.trim()}" already exists.`)
    }
    return { id, name: name.trim(), bookCount: 0 }
  }

  rename(id: string, name: string): void {
    try {
      const r = this.db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name.trim(), id)
      if (r.changes === 0) throw new AppError('NOT_FOUND', 'Collection not found.')
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('DUPLICATE', `A collection named "${name.trim()}" already exists.`)
    }
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  }

  addBook(collectionId: string, bookId: string): void {
    try {
      this.db
        .prepare('INSERT OR IGNORE INTO book_collections (book_id, collection_id) VALUES (?, ?)')
        .run(bookId, collectionId)
    } catch {
      throw new AppError('NOT_FOUND', 'Book or collection not found.')
    }
  }

  removeBook(collectionId: string, bookId: string): void {
    this.db
      .prepare('DELETE FROM book_collections WHERE book_id = ? AND collection_id = ?')
      .run(bookId, collectionId)
  }
}
