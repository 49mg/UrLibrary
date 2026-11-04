/**
 * Single source of truth for every IPC channel between the renderer and the main process.
 * Main registers handlers for `IpcInvokeMap`, preload exposes them as `window.api`,
 * and both sides share these types so a channel can't drift out of sync.
 */

import type { TextQuote } from './anchoring'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ReaderTheme = 'light' | 'dark' | 'sepia'
export type ReaderFont = 'serif' | 'sans'
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AppSettings {
  theme: ThemePreference
  reader: {
    theme: ReaderTheme
    fontFamily: ReaderFont
    fontSize: number
    lineHeight: number
  }
  ai: {
    effort: AiEffort
    targetLanguage: string
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  userDataPath: string
  libraryPath: string
  dbPath: string
}

export interface ApiKeyStatus {
  isSet: boolean
  /** Last 4 characters only, for display. The key itself never leaves the main process. */
  hint: string | null
  /** 'os' = OS keychain, 'weak' = Electron's fallback (e.g. Linux without a keyring), 'none' = unavailable */
  protection: 'os' | 'weak' | 'none'
}

export interface ApiKeyTestResult {
  ok: boolean
  message: string
}

export type BookFormat = 'pdf' | 'epub' | 'docx' | 'txt' | 'md'

export type ReadingStatus = 'unread' | 'reading' | 'finished'
/** pending → processing → done | needs_ocr | error */
export type TextStatus = 'pending' | 'processing' | 'done' | 'needs_ocr' | 'error'

export interface BookSummary {
  id: string
  title: string
  author: string | null
  format: BookFormat
  source: string
  language: string | null
  coverUrl: string | null
  addedAt: string
  lastOpenedAt: string | null
  progress: number
  status: ReadingStatus
  textStatus: TextStatus
  pageCount: number | null
  wordCount: number | null
  collectionIds: string[]
}

export interface BookDetails extends BookSummary {
  description: string | null
  originalName: string | null
  sizeBytes: number | null
  textError: string | null
}

export interface BookPatch {
  id: string
  title?: string
  author?: string | null
  language?: string | null
  description?: string | null
  status?: ReadingStatus
}

export type ReaderFlow = 'paginated' | 'scrolled'
export type PdfZoom = 'page-width' | 'page-fit' | 'auto' | number

/** Effective reading settings for one book: app defaults overlaid with the book's own choices. */
export interface ReaderPrefs {
  theme: ReaderTheme
  fontFamily: ReaderFont
  fontSize: number
  lineHeight: number
  /** EPUB only */
  flow: ReaderFlow
  /** PDF only */
  pdfZoom: PdfZoom
}

/** Everything the reader needs to open a book where the user left off. */
export interface ReaderSession {
  book: BookDetails
  /** book:// URL of the original file */
  fileUrl: string
  /** Last saved position, e.g. `page:12`, `cfi:epubcfi(...)`, `scroll:0.42` */
  location: string | null
  prefs: ReaderPrefs
}

export type AnnotationType = 'highlight' | 'bookmark'
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

/** Where an annotation sits, in the terms of the format it was made in. */
export type Anchor =
  /** rects: [x, y, width, height] as fractions (0..1) of the page, origin top-left */
  | { kind: 'pdf'; page: number; rects: Array<[number, number, number, number]> }
  | { kind: 'epub'; cfi: string }
  | ({ kind: 'text' } & TextQuote)
  /** Bookmarks: just a position */
  | { kind: 'location' }

export interface Annotation {
  id: string
  bookId: string
  type: AnnotationType
  anchor: Anchor
  /** Reader location to jump to (same format as reading positions). */
  location: string
  chapter: string | null
  /** 0..1 position through the book, for ordering. */
  sortKey: number
  /** The highlighted text */
  text: string | null
  note: string | null
  color: HighlightColor | null
  createdAt: string
  updatedAt: string
}

export type NewAnnotation = Pick<
  Annotation,
  'bookId' | 'type' | 'anchor' | 'location' | 'sortKey'
> &
  Partial<Pick<Annotation, 'chapter' | 'text' | 'note' | 'color'>>

export interface AnnotationWithBook extends Annotation {
  bookTitle: string
  bookAuthor: string | null
  bookFormat: BookFormat
}

export interface ImportResult {
  imported: Array<{ id: string; title: string }>
  duplicates: Array<{ id: string; title: string; path: string }>
  failed: Array<{ path: string; reason: string }>
}

export interface Collection {
  id: string
  name: string
  bookCount: number
}

export interface SearchHit {
  bookId: string
  bookTitle: string
  chunkId: string
  chapter: string | null
  location: string
  /** Text with matches wrapped in SNIPPET_START / SNIPPET_END markers (render as <mark>). */
  snippet: string
}

export interface SearchResults {
  books: BookSummary[]
  hits: SearchHit[]
}

export const SNIPPET_START = '\u0001'
export const SNIPPET_END = '\u0002'

export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'ara', label: 'Arabic' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'rus', label: 'Russian' },
  { code: 'tur', label: 'Turkish' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' }
] as const
export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code']

export type JobKind = 'import' | 'download' | 'ai' | 'ocr'
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  kind: JobKind
  label: string
  status: JobStatus
  /** 0..1, or null when indeterminate */
  progress: number | null
  bookId?: string
  error?: string
}

export interface IpcInvokeMap {
  'app:info': { args: void; result: AppInfo }
  'settings:get': { args: void; result: AppSettings }
  'settings:update': { args: DeepPartial<AppSettings>; result: AppSettings }
  'apiKey:status': { args: void; result: ApiKeyStatus }
  'apiKey:set': { args: { key: string }; result: ApiKeyStatus }
  'apiKey:clear': { args: void; result: ApiKeyStatus }
  'apiKey:test': { args: void; result: ApiKeyTestResult }
  'books:list': { args: void; result: BookSummary[] }
  'books:get': { args: { id: string }; result: BookDetails }
  'books:update': { args: BookPatch; result: BookDetails }
  'books:delete': { args: { id: string }; result: void }
  'books:showInFolder': { args: { id: string }; result: void }
  'books:reextract': { args: { id: string }; result: void }
  'books:runOcr': { args: { id: string; language: OcrLanguage }; result: void }
  'reader:open': { args: { id: string }; result: ReaderSession }
  'reader:saveProgress': {
    args: { id: string; location: string; progress: number }
    result: { status: ReadingStatus }
  }
  'reader:savePrefs': { args: { id: string; prefs: Partial<ReaderPrefs> }; result: ReaderPrefs }
  /** DOCX, TXT and Markdown rendered to HTML (unsanitized; the renderer sanitizes it). */
  'reader:html': { args: { id: string }; result: { html: string } }
  'annotations:list': { args: { bookId: string }; result: Annotation[] }
  'annotations:create': { args: NewAnnotation; result: Annotation }
  'annotations:update': {
    args: { id: string; note?: string | null; color?: HighlightColor }
    result: Annotation
  }
  'annotations:delete': { args: { id: string }; result: void }
  /** All notes across books (Notes page), newest first. */
  'annotations:search': {
    args: { query?: string; color?: HighlightColor; type?: AnnotationType; limit?: number }
    result: AnnotationWithBook[]
  }
  'notebook:get': {
    args: { bookId: string }
    result: { content: string; updatedAt: string | null }
  }
  'notebook:save': { args: { bookId: string; content: string }; result: { updatedAt: string } }
  /** Both show a save dialog; null when the user cancels. */
  'export:markdown': { args: { bookId: string }; result: { path: string } | null }
  'export:annotatedPdf': { args: { bookId: string }; result: { path: string } | null }
  'library:openFolder': { args: void; result: void }
  'library:importDialog': { args: { mode: 'files' | 'folder' }; result: ImportResult | null }
  'library:importPaths': { args: { paths: string[] }; result: ImportResult }
  'search:fullText': { args: { query: string; limit?: number }; result: SearchResults }
  'collections:list': { args: void; result: Collection[] }
  'collections:create': { args: { name: string }; result: Collection }
  'collections:rename': { args: { id: string; name: string }; result: void }
  'collections:delete': { args: { id: string }; result: void }
  'collections:addBook': { args: { collectionId: string; bookId: string }; result: void }
  'collections:removeBook': { args: { collectionId: string; bookId: string }; result: void }
  'jobs:list': { args: void; result: Job[] }
  'jobs:cancel': { args: { id: string }; result: void }
}

export interface IpcEventMap {
  'jobs:update': Job
  'settings:changed': AppSettings
  /** Books, collections or extracted text changed; the UI should refetch. */
  'library:changed': { bookId?: string }
  'annotations:changed': { bookId: string }
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'jobs:update',
  'settings:changed',
  'library:changed',
  'annotations:changed'
]

/** Every invoke goes over the wire wrapped in this envelope so errors keep a code and message. */
export type IpcEnvelope<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
