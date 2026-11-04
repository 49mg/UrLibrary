import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { BookFormat, ImportResult } from '../../shared/ipc'
import type { BooksRepo } from '../db/booksRepo'
import type { FileStore } from '../services/fileStore'
import type { JobContext, JobQueue } from '../services/jobQueue'
import type { WorkerTask } from '../workers/protocol'
import type { ExtractResult } from './types'
import { chunkChapters } from './chunker'
import { countWords, titleFromFileName } from './textUtils'

export const SUPPORTED_EXTENSIONS: Record<string, BookFormat> = {
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md'
}

const MAX_FILE_BYTES = 1024 * 1024 * 1024 // 1 GB
const MAX_FOLDER_FILES = 5000

export function formatForPath(p: string): BookFormat | null {
  return SUPPORTED_EXTENSIONS[extname(p).toLowerCase()] ?? null
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Tasks that produce extracted text (as opposed to e.g. HTML rendering). */
export type ExtractTask = Extract<WorkerTask, { type: 'extract' | 'ocr' }>

export type Extractor = (
  task: ExtractTask,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
) => Promise<ExtractResult>

export interface ImportDeps {
  books: BooksRepo
  files: FileStore
  jobs: JobQueue
  extract: Extractor
  /** Folder where OCR language data is cached. */
  ocrCachePath: string
  /** Called whenever books or their text change, so the UI can refresh. */
  onChanged: (bookId?: string) => void
}

/** Saved next to the book so AI features can reuse the text without re-parsing the file. */
export interface ChunksFile {
  version: 1
  chapters: Array<{ index: number; title: string; location: string }>
  chunks: ReturnType<typeof chunkChapters>
}

export class ImportService {
  constructor(private d: ImportDeps) {}

  /** Expands folders (recursively) into supported files. Hidden files and folders are skipped. */
  async expandPaths(paths: string[]): Promise<string[]> {
    const out: string[] = []
    const walk = async (p: string, depth: number): Promise<void> => {
      if (out.length >= MAX_FOLDER_FILES) return
      let s
      try {
        s = await stat(p)
      } catch {
        out.push(p) // let importOne report it
        return
      }
      if (s.isDirectory()) {
        if (depth > 8) return
        const entries = await readdir(p).catch(() => [] as string[])
        for (const name of entries.sort()) {
          if (name.startsWith('.')) continue
          await walk(join(p, name), depth + 1)
        }
      } else if (depth === 0 || formatForPath(p)) {
        out.push(p)
      }
    }
    for (const p of paths) await walk(p, 0)
    return out
  }

  async importPaths(paths: string[]): Promise<ImportResult> {
    const result: ImportResult = { imported: [], duplicates: [], failed: [] }
    const seen = new Map<string, { id: string; title: string }>()
    for (const path of await this.expandPaths(paths)) {
      try {
        const r = await this.importOne(path, seen)
        if (r.duplicate) result.duplicates.push({ ...r.book, path })
        else result.imported.push(r.book)
      } catch (err) {
        result.failed.push({ path, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (result.imported.length) this.d.onChanged()
    return result
  }

  private async importOne(
    path: string,
    seen: Map<string, { id: string; title: string }>
  ): Promise<{ duplicate: boolean; book: { id: string; title: string } }> {
    const format = formatForPath(path)
    if (!format) throw new Error('Unsupported file type (use PDF, EPUB, DOCX, TXT or Markdown)')
    const s = await stat(path)
    if (!s.isFile()) throw new Error('Not a regular file')
    if (s.size === 0) throw new Error('File is empty')
    if (s.size > MAX_FILE_BYTES) throw new Error('File is larger than 1 GB')

    const hash = await sha256File(path)
    const existing = seen.get(hash) ?? this.d.books.findByHash(hash)
    if (existing) return { duplicate: true, book: existing }

    const id = randomUUID()
    const dir = this.d.files.ensureBookDir(id)
    const fileName = `original.${format === 'md' ? 'md' : format}`
    try {
      await copyFile(path, join(dir, fileName))
      const title = titleFromFileName(basename(path))
      this.d.books.insert({
        id,
        title,
        format,
        filePath: fileName,
        hash,
        originalName: basename(path),
        sizeBytes: s.size
      })
      seen.set(hash, { id, title })
      this.queueExtraction(id)
      return { duplicate: false, book: { id, title } }
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  }

  queueExtraction(id: string): void {
    const info = this.d.books.getFileInfo(id)
    if (!info) return
    this.d.books.setTextStatus(id, 'pending')
    this.d.jobs.add(
      'import',
      `Reading “${info.title}”`,
      (ctx) =>
        this.process(id, ctx, (dir) => ({
          type: 'extract',
          filePath: join(dir, info.filePath),
          format: info.format,
          bookDir: dir
        })),
      id
    )
  }

  queueOcr(id: string, language: string): void {
    const info = this.d.books.getFileInfo(id)
    if (!info) return
    if (info.format !== 'pdf') throw new Error('OCR is only available for PDF files')
    this.d.books.setTextStatus(id, 'pending')
    this.d.onChanged(id)
    this.d.jobs.add(
      'ocr',
      `Recognizing text in “${info.title}”`,
      async (ctx) => {
        await mkdir(this.d.ocrCachePath, { recursive: true })
        await this.process(id, ctx, (dir) => ({
          type: 'ocr',
          filePath: join(dir, info.filePath),
          language,
          cachePath: this.d.ocrCachePath
        }))
      },
      id
    )
  }

  private async process(
    id: string,
    ctx: JobContext,
    makeTask: (dir: string) => ExtractTask
  ): Promise<void> {
    const dir = this.d.files.bookDir(id)
    this.d.books.setTextStatus(id, 'processing')
    this.d.onChanged(id)
    try {
      const result = await this.d.extract(makeTask(dir), (f) => ctx.progress(f), ctx.signal)
      const chunks = chunkChapters(result.chapters)
      const file: ChunksFile = {
        version: 1,
        chapters: result.chapters.map((c, index) => ({
          index,
          title: c.title,
          location: c.location
        })),
        chunks
      }
      await writeFile(join(dir, 'text', 'chunks.json'), JSON.stringify(file))
      const wordCount = countWords(result.chapters.flatMap((c) => c.paragraphs))
      const status = result.needsOcr ? 'needs_ocr' : wordCount === 0 ? 'error' : 'done'
      this.d.books.applyExtraction(
        id,
        { ...result.meta, coverPath: result.coverPath, pageCount: result.pageCount, wordCount },
        chunks,
        status
      )
      if (status === 'error')
        this.d.books.setTextStatus(id, 'error', 'No readable text was found in this file.')
    } catch (err) {
      if (!this.d.books.getFileInfo(id)) return // deleted while processing
      if (ctx.signal.aborted) this.d.books.setTextStatus(id, 'error', 'Cancelled')
      else this.d.books.setTextStatus(id, 'error', err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      this.d.onChanged(id)
    }
  }

  async deleteBook(id: string): Promise<void> {
    this.d.jobs.cancelForBook(id)
    this.d.books.delete(id)
    await rm(this.d.files.bookDir(id), { recursive: true, force: true })
    this.d.onChanged(id)
  }

  /** Re-queues books whose extraction never finished (app quit or crashed mid-import). */
  resumeInterrupted(): void {
    for (const id of this.d.books.interruptedImports()) {
      if (!this.d.jobs.hasActiveJob(id)) this.queueExtraction(id)
    }
  }
}
