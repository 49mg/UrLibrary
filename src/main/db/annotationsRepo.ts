import { randomUUID } from 'node:crypto'
import type { Db } from './index'
import type {
  Anchor,
  Annotation,
  AnnotationType,
  AnnotationWithBook,
  BookFormat,
  HighlightColor,
  NewAnnotation
} from '../../shared/ipc'

interface Row {
  id: string
  book_id: string
  type: AnnotationType
  anchor_json: string
  location: string
  chapter: string | null
  sort_key: number
  text: string | null
  note: string | null
  color: HighlightColor | null
  version_id: string | null
  created_at: string
  updated_at: string
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

function toAnnotation(r: Row): Annotation {
  let anchor: Anchor
  try {
    anchor = JSON.parse(r.anchor_json) as Anchor
  } catch {
    anchor = { kind: 'location' }
  }
  return {
    id: r.id,
    bookId: r.book_id,
    type: r.type,
    anchor,
    location: r.location,
    chapter: r.chapter,
    sortKey: r.sort_key,
    text: r.text,
    note: r.note,
    color: r.color,
    versionId: r.version_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/** Annotations belong to the original book (version_id NULL) or to one AI version of it. */
export class AnnotationsRepo {
  constructor(private db: Db) {}

  list(bookId: string, versionId: string | null = null): Annotation[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM annotations WHERE book_id = ? AND version_id IS ?
           ORDER BY sort_key, created_at`
        )
        .all(bookId, versionId) as unknown as Row[]
    ).map(toAnnotation)
  }

  get(id: string): Annotation | null {
    const r = this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as unknown as
      Row | undefined
    return r ? toAnnotation(r) : null
  }

  create(a: NewAnnotation): Annotation {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO annotations (id, book_id, type, anchor_json, location, chapter, sort_key, text, note, color, version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        a.bookId,
        a.type,
        JSON.stringify(a.anchor),
        a.location,
        a.chapter ?? null,
        a.sortKey,
        a.text ?? null,
        a.note?.trim() || null,
        a.type === 'highlight' ? (a.color ?? 'yellow') : null,
        a.versionId ?? null
      )
    return this.get(id) as Annotation
  }

  update(id: string, patch: { note?: string | null; color?: HighlightColor }): Annotation | null {
    const sets: string[] = []
    const vals: Array<string | null> = []
    if (patch.note !== undefined) {
      sets.push('note = ?')
      vals.push(patch.note?.trim() || null)
    }
    if (patch.color !== undefined) {
      sets.push('color = ?')
      vals.push(patch.color)
    }
    if (sets.length) {
      this.db
        .prepare(`UPDATE annotations SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = ?`)
        .run(...vals, id)
    }
    return this.get(id)
  }

  delete(id: string): string | null {
    const a = this.get(id)
    if (!a) return null
    this.db.prepare('DELETE FROM annotations WHERE id = ?').run(id)
    return a.bookId
  }

  search(opts: {
    query?: string
    color?: HighlightColor
    type?: AnnotationType
    limit?: number
  }): AnnotationWithBook[] {
    const where: string[] = ['1 = 1']
    const vals: Array<string | number> = []
    const q = opts.query?.trim()
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push(
        "(a.text LIKE ? ESCAPE '\\' OR a.note LIKE ? ESCAPE '\\' OR b.title LIKE ? ESCAPE '\\')"
      )
      vals.push(like, like, like)
    }
    if (opts.color) {
      where.push('a.color = ?')
      vals.push(opts.color)
    }
    if (opts.type) {
      where.push('a.type = ?')
      vals.push(opts.type)
    }
    const rows = this.db
      .prepare(
        `SELECT a.*, b.title AS book_title, b.author AS book_author, b.format AS book_format
         FROM annotations a JOIN books b ON b.id = a.book_id
         WHERE ${where.join(' AND ')}
         ORDER BY a.updated_at DESC LIMIT ?`
      )
      .all(...vals, opts.limit ?? 500) as unknown as Array<
      Row & { book_title: string; book_author: string | null; book_format: BookFormat }
    >
    return rows.map((r) => ({
      ...toAnnotation(r),
      bookTitle: r.book_title,
      bookAuthor: r.book_author,
      bookFormat: r.book_format
    }))
  }
}

export class NotebooksRepo {
  constructor(private db: Db) {}

  get(bookId: string): { content: string; updatedAt: string | null } {
    const r = this.db
      .prepare('SELECT content, updated_at FROM notebooks WHERE book_id = ?')
      .get(bookId) as { content: string; updated_at: string } | undefined
    return { content: r?.content ?? '', updatedAt: r?.updated_at ?? null }
  }

  save(bookId: string, content: string): { updatedAt: string } {
    this.db
      .prepare(
        `INSERT INTO notebooks (book_id, content) VALUES (?, ?)
         ON CONFLICT(book_id) DO UPDATE SET content = excluded.content, updated_at = ${NOW}`
      )
      .run(bookId, content)
    return { updatedAt: this.get(bookId).updatedAt as string }
  }
}
