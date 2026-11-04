import { mkdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const BOOK_SCHEME = 'book'
const BOOK_ID_RE = /^[a-zA-Z0-9-]{1,64}$/

/**
 * Library layout on disk:
 *   <libraryRoot>/<bookId>/original.<ext>
 *                         /cover.jpg
 *                         /text/*.json        extracted text chunks
 *                         /versions/*.md      AI-generated versions
 */
export class FileStore {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
    mkdirSync(this.root, { recursive: true })
  }

  bookDir(bookId: string): string {
    assertBookId(bookId)
    return join(this.root, bookId)
  }

  ensureBookDir(bookId: string): string {
    const dir = this.bookDir(bookId)
    mkdirSync(join(dir, 'text'), { recursive: true })
    mkdirSync(join(dir, 'versions'), { recursive: true })
    return dir
  }

  /** Resolves a path inside a book's folder, or throws if it would escape it. */
  resolveInBook(bookId: string, relPath: string): string {
    return resolveInside(this.bookDir(bookId), relPath)
  }

  /** Maps a `book://<bookId>/<path>` URL to a file on disk. Returns null for anything invalid. */
  pathFromUrl(url: string): string | null {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== `${BOOK_SCHEME}:`) return null
    const bookId = parsed.hostname
    if (!BOOK_ID_RE.test(bookId)) return null
    try {
      return this.resolveInBook(bookId, decodeURIComponent(parsed.pathname))
    } catch {
      return null
    }
  }
}

export function assertBookId(bookId: string): void {
  if (!BOOK_ID_RE.test(bookId)) throw new Error(`Invalid book id: ${bookId}`)
}

/** Joins `relPath` onto `base`, rejecting absolute paths and anything resolving outside `base`. */
export function resolveInside(base: string, relPath: string): string {
  const cleaned = relPath.replace(/^[/\\]+/, '')
  if (!cleaned || isAbsolute(cleaned)) throw new Error('Path must be relative')
  const full = resolve(base, cleaned)
  const rel = relative(base, full)
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel)) {
    throw new Error('Path escapes base directory')
  }
  return full
}

export function coverUrl(bookId: string, coverPath: string): string {
  return `${BOOK_SCHEME}://${bookId}/${coverPath.split(sep).map(encodeURIComponent).join('/')}`
}
