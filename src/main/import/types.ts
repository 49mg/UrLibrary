import type { BookFormat } from '../../shared/ipc'

export interface ExtractedChapter {
  title: string
  /** Format-specific location the reader can jump to: `page:12`, `href:OEBPS/ch3.xhtml`, `section:4` */
  location: string
  /** Paragraphs of plain text, in reading order. */
  paragraphs: string[]
  /** For PDFs: one entry per page in this chapter, so chunks can point at exact pages. */
  pages?: Array<{ page: number; paragraphs: string[] }>
}

export interface ExtractResult {
  meta: {
    title?: string | null
    author?: string | null
    language?: string | null
    description?: string | null
  }
  pageCount: number | null
  chapters: ExtractedChapter[]
  /** Path of the cover image written into the book folder, relative to it (e.g. `cover.jpg`). */
  coverPath: string | null
  /** True for PDFs that are (mostly) scanned images with no text layer. */
  needsOcr: boolean
}

export interface ExtractOptions {
  filePath: string
  format: BookFormat
  /** The book's folder; extractors may write `cover.jpg` here. */
  bookDir: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelled')
}
