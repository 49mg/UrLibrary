import type { Db } from './index'
import type {
  BookDetails,
  BookFormat,
  BookPatch,
  BookSummary,
  ReaderPrefs,
  ReadingStatus,
  TextStatus
} from '../../shared/ipc'
import { coverUrl } from '../services/fileStore'

interface BookRow {
  id: string
  title: string
  author: string | null
  format: BookFormat
  source: string
  source_id: string | null
  language: string | null
  cover_path: string | null
  added_at: string
  last_opened_at: string | null
  progress: number
  status: ReadingStatus
  text_status: TextStatus
  page_count: number | null
  word_count: number | null
  collection_ids: string | null
}

interface DetailRow extends BookRow {
  description: string | null
  original_name: string | null
  size_bytes: number | null
  text_error: string | null
  file_path: string
  hash: string
}

export interface NewBook {
  id: string
  title: string
  format: BookFormat
  filePath: string
  hash: string
  originalName: string
  sizeBytes: number
  author?: string | null
  source?: string
  sourceId?: string | null
  license?: string | null
}

export interface ExtractedMeta {
  title?: string | null
  author?: string | null
  language?: string | null
  description?: string | null
  coverPath?: string | null
  pageCount?: number | null
  wordCount?: number | null
}

export interface ChunkRow {
  chunkId: string
  chapter: string | null
  location: string
  content: string
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

function parseJson<T>(s: string | null): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

const SELECT = `
  SELECT b.*,
    (SELECT group_concat(collection_id) FROM book_collections bc WHERE bc.book_id = b.id) AS collection_ids
  FROM books b`

function toSummary(r: BookRow): BookSummary {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    format: r.format,
    source: r.source,
    sourceId: r.source_id,
    language: r.language,
    coverUrl: r.cover_path ? coverUrl(r.id, r.cover_path) : null,
    addedAt: r.added_at,
    lastOpenedAt: r.last_opened_at,
    progress: r.progress,
    status: r.status,
    textStatus: r.text_status,
    pageCount: r.page_count,
    wordCount: r.word_count,
    collectionIds: r.collection_ids ? r.collection_ids.split(',') : []
  }
}

export class BooksRepo {
  constructor(private db: Db) {}

  list(): BookSummary[] {
    const rows = this.db
      .prepare(`${SELECT} ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC`)
      .all() as unknown as BookRow[]
    return rows.map(toSummary)
  }

  get(id: string): BookDetails | null {
    const r = this.db.prepare(`${SELECT} WHERE b.id = ?`).get(id) as unknown as
      DetailRow | undefined
    if (!r) return null
    return {
      ...toSummary(r),
      description: r.description,
      originalName: r.original_name,
      sizeBytes: r.size_bytes,
      textError: r.text_error
    }
  }

  /** Internal fields the renderer never needs. */
  getFileInfo(id: string): { filePath: string; format: BookFormat; title: string } | null {
    const r = this.db.prepare('SELECT file_path, format, title FROM books WHERE id = ?').get(id) as
      { file_path: string; format: BookFormat; title: string } | undefined
    return r ? { filePath: r.file_path, format: r.format, title: r.title } : null
  }

  /** A book downloaded earlier from the same catalog entry. */
  findBySource(source: string, sourceId: string): { id: string; title: string } | null {
    const r = this.db
      .prepare('SELECT id, title FROM books WHERE source = ? AND source_id = ? LIMIT 1')
      .get(source, sourceId) as { id: string; title: string } | undefined
    return r ?? null
  }

  findByHash(hash: string): { id: string; title: string } | null {
    const r = this.db.prepare('SELECT id, title FROM books WHERE hash = ?').get(hash) as
      { id: string; title: string } | undefined
    return r ?? null
  }

  insert(b: NewBook): void {
    this.db
      .prepare(
        `INSERT INTO books (id, title, author, format, file_path, hash, original_name, size_bytes, source, source_id, license)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        b.id,
        b.title,
        b.author ?? null,
        b.format,
        b.filePath,
        b.hash,
        b.originalName,
        b.sizeBytes,
        b.source ?? 'local',
        b.sourceId ?? null,
        b.license ?? null
      )
  }

  update(p: BookPatch): void {
    const sets: string[] = []
    const vals: Array<string | number | null> = []
    const add = (col: string, v: string | number | null | undefined): void => {
      if (v === undefined) return
      sets.push(`${col} = ?`)
      vals.push(v)
    }
    add('title', p.title)
    add('author', p.author)
    add('language', p.language)
    add('description', p.description)
    add('status', p.status)
    if (sets.length === 0) return
    // Remember manual edits so a later re-extraction doesn't overwrite them.
    if (p.title !== undefined || p.author !== undefined || p.language !== undefined) {
      sets.push('meta_edited = 1')
    }
    this.db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...vals, p.id)
  }

  setTextStatus(id: string, status: TextStatus, error: string | null = null): void {
    this.db
      .prepare('UPDATE books SET text_status = ?, text_error = ? WHERE id = ?')
      .run(status, error, id)
  }

  /**
   * Stores extraction output: metadata (unless the user edited it), cover, and the full-text index.
   * Runs in one transaction so a failed import never leaves half an index behind.
   */
  applyExtraction(id: string, meta: ExtractedMeta, chunks: ChunkRow[], status: TextStatus): void {
    const db = this.db
    db.exec('BEGIN')
    try {
      const row = db.prepare('SELECT meta_edited, source FROM books WHERE id = ?').get(id) as
        { meta_edited: number; source: string } | undefined
      if (!row) throw new Error('Book was deleted during import')
      if (row.source !== 'local') {
        // Downloaded books already have catalog metadata, usually better than what's embedded in
        // the file (scanned PDFs often have none or junk); the file only fills the gaps.
        db.prepare(
          `UPDATE books SET
             author = COALESCE(author, NULLIF(?, '')),
             language = COALESCE(language, NULLIF(?, '')),
             description = COALESCE(description, NULLIF(?, ''))
           WHERE id = ?`
        ).run(meta.author ?? null, meta.language ?? null, meta.description ?? null, id)
      } else if (!row.meta_edited) {
        db.prepare(
          `UPDATE books SET
             title = COALESCE(NULLIF(?, ''), title),
             author = COALESCE(NULLIF(?, ''), author),
             language = COALESCE(NULLIF(?, ''), language),
             description = COALESCE(NULLIF(?, ''), description)
           WHERE id = ?`
        ).run(
          meta.title ?? null,
          meta.author ?? null,
          meta.language ?? null,
          meta.description ?? null,
          id
        )
      }
      db.prepare(
        `UPDATE books SET cover_path = COALESCE(?, cover_path), page_count = ?, word_count = ?,
           text_status = ?, text_error = NULL WHERE id = ?`
      ).run(meta.coverPath ?? null, meta.pageCount ?? null, meta.wordCount ?? null, status, id)
      db.prepare('DELETE FROM book_text WHERE book_id = ?').run(id)
      const ins = db.prepare(
        'INSERT INTO book_text (book_id, chunk_id, chapter, location, content) VALUES (?, ?, ?, ?, ?)'
      )
      for (const c of chunks) ins.run(id, c.chunkId, c.chapter, c.location, c.content)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  delete(id: string): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM book_text WHERE book_id = ?').run(id)
      this.db.prepare('DELETE FROM books WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Marks the book as opened now and returns the saved position and per-book reader prefs. */
  open(id: string): { location: string | null; prefs: Partial<ReaderPrefs> } | null {
    const r = this.db
      .prepare('SELECT progress_json, reader_prefs FROM books WHERE id = ?')
      .get(id) as { progress_json: string | null; reader_prefs: string | null } | undefined
    if (!r) return null
    this.db.prepare(`UPDATE books SET last_opened_at = ${NOW} WHERE id = ?`).run(id)
    return {
      location: parseJson<{ location?: string }>(r.progress_json)?.location ?? null,
      prefs: parseJson<Partial<ReaderPrefs>>(r.reader_prefs) ?? {}
    }
  }

  /**
   * Saves the reading position. Opening a book moves it from unread to reading; reaching the end
   * marks it finished. A finished book stays finished if re-read, unless the user changes it.
   */
  saveProgress(id: string, location: string, progress: number): ReadingStatus | null {
    const p = Math.max(0, Math.min(1, progress))
    this.db
      .prepare(
        `UPDATE books SET
           progress_json = ?, progress = ?, last_opened_at = ${NOW},
           status = CASE
             WHEN ? >= 0.98 THEN 'finished'
             WHEN status = 'unread' THEN 'reading'
             ELSE status END
         WHERE id = ?`
      )
      .run(JSON.stringify({ location, progress: p }), p, p, id)
    const r = this.db.prepare('SELECT status FROM books WHERE id = ?').get(id) as
      { status: ReadingStatus } | undefined
    return r?.status ?? null
  }

  saveReaderPrefs(id: string, patch: Partial<ReaderPrefs>): Partial<ReaderPrefs> {
    const r = this.db.prepare('SELECT reader_prefs FROM books WHERE id = ?').get(id) as
      { reader_prefs: string | null } | undefined
    const next = { ...(parseJson<Partial<ReaderPrefs>>(r?.reader_prefs ?? null) ?? {}), ...patch }
    this.db.prepare('UPDATE books SET reader_prefs = ? WHERE id = ?').run(JSON.stringify(next), id)
    return next
  }

  /** Books stuck in 'processing' after a crash or quit get retried on next start. */
  interruptedImports(): string[] {
    return (
      this.db
        .prepare("SELECT id FROM books WHERE text_status IN ('pending','processing')")
        .all() as Array<{ id: string }>
    ).map((r) => r.id)
  }
}
