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

export type ProviderId = 'gutenberg' | 'standardebooks' | 'openlibrary' | 'archive' | 'arxiv'

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
  discover: {
    providers: Record<ProviderId, boolean>
  }
  updates: {
    /** Check for and download new versions in the background. */
    auto: boolean
  }
}

export type UpdateStatus =
  'unsupported' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  /** The new version, once one is found. */
  version?: string
  /** 0..100 while downloading */
  percent?: number
  /** Why updates can't be installed from inside the app, or what went wrong. */
  message?: string
  checkedAt?: string
}

/** Display names. */
export const APP_NAME = 'Ur Library'
export const APP_NAME_AR = 'مكتبة اور'

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
  /** 'local' for imported files, otherwise the catalog it was downloaded from */
  source: string
  sourceId: string | null
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
  /** AI versions of this book, newest first. */
  versions: BookVersion[]
  /** Set when reading an AI version instead of the original. */
  version: BookVersion | null
  /** book:// URL of the original file */
  fileUrl: string
  /** Last saved position, e.g. `page:12`, `cfi:epubcfi(...)`, `scroll:0.42` */
  location: string | null
  prefs: ReaderPrefs
}

/** A downloadable file offered by a catalog. URLs stay in the main process; the UI picks by format. */
export interface CatalogFormat {
  format: Extract<BookFormat, 'epub' | 'pdf' | 'txt'>
  label: string
  sizeBytes?: number | null
}

export interface CatalogResult {
  /** `${provider}:${id}` */
  key: string
  provider: ProviderId
  /** Provider's own id (Gutenberg number, archive.org identifier, OL work key, arXiv id, SE slug) */
  id: string
  title: string
  authors: string[]
  year: number | null
  language: string | null
  coverUrl: string | null
  description: string | null
  subjects: string[]
  /** Empty when files must be looked up first (see discover:details). */
  formats: CatalogFormat[]
  /** Why this is free to download, e.g. "Public domain in the USA". */
  license: string
  /** The book's page on the provider's website. */
  pageUrl: string
  /** Set when this exact item is already in the library. */
  inLibraryBookId: string | null
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  description: string
  /** false = browse only (e.g. Standard Ebooks' public feed has no search) */
  searchable: boolean
  enabled: boolean
}

// ---------- AI Studio ----------

export type AiAction =
  'summarize' | 'simplify' | 'translate' | 'rewrite' | 'study-notes' | 'quiz' | 'custom'

export interface AiActionOptions {
  /** summarize */
  length?: 'brief' | 'detailed'
  /** simplify */
  level?: 'child' | 'teen' | 'plain'
  /** translate */
  language?: string
  /** rewrite, e.g. "modern English", "for a 10-year-old", "as a screenplay" */
  style?: string
  /** custom */
  instruction?: string
}

export type AiScope =
  | { kind: 'book' }
  | { kind: 'chapters'; indexes: number[] }
  /** A passage, e.g. the current selection in the reader. */
  | { kind: 'text'; text: string; label?: string }

export interface AiJobRequest {
  bookId: string
  action: AiAction
  options: AiActionOptions
  scope: AiScope
}

export interface AiEstimate {
  parts: number
  inputTokens: number
  /** A rough guess based on the action (a summary is far shorter than a translation). */
  outputTokensEstimate: number
  costUsd: number
  model: string
}

export interface ChapterInfo {
  index: number
  title: string
  chars: number
}

export type AiJobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
export type AiPartStatus = 'pending' | 'running' | 'done' | 'error'

export interface AiJobPart {
  idx: number
  title: string
  status: AiPartStatus
  sourceChars: number
  outputChars: number
}

export interface AiJob {
  id: string
  bookId: string
  bookTitle: string
  action: AiAction
  title: string
  status: AiJobStatus
  model: string
  parts: AiJobPart[]
  error: string | null
  versionId: string | null
  inputTokens: number
  outputTokens: number
  createdAt: string
}

/** One part's original text and generated text, for the side-by-side view. */
export interface AiPartDetail {
  idx: number
  title: string
  source: string
  output: string
}

export interface BookVersion {
  id: string
  bookId: string
  kind: string
  title: string
  model: string | null
  createdAt: string
  inputTokens: number | null
  outputTokens: number | null
}

export type AskAction = 'explain' | 'define' | 'translate' | 'simplify'

// ---------- Chat with a book ----------

export interface ChatCitation {
  /** Number shown in the answer, e.g. [2] */
  n: number
  location: string
  chapter: string | null
  /** The cited passage */
  quote: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** Markdown. Assistant answers contain [[n]] markers for citations. */
  content: string
  citations: ChatCitation[]
  createdAt: string
  inputTokens: number | null
  cacheReadTokens: number | null
  outputTokens: number | null
  /** true when this turn started a new context (book text changed or history got too long) */
  freshContext: boolean
}

export interface ChatInfo {
  /** 'full': the whole book is sent (cached); 'retrieval': relevant passages are searched per question */
  mode: 'full' | 'retrieval'
  bookTokens: number
  /** Rough cost of the first question in a session, and of follow-ups while the cache is warm. */
  firstQuestionUsd: number
  followUpUsd: number
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
  /** Set when the annotation belongs to an AI version, not the original book. */
  versionId: string | null
  createdAt: string
  updatedAt: string
}

export type NewAnnotation = Pick<
  Annotation,
  'bookId' | 'type' | 'anchor' | 'location' | 'sortKey'
> &
  Partial<Pick<Annotation, 'chapter' | 'text' | 'note' | 'color' | 'versionId'>>

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
  'reader:open': { args: { id: string; versionId?: string }; result: ReaderSession }
  'reader:saveProgress': {
    args: { id: string; location: string; progress: number }
    result: { status: ReadingStatus }
  }
  'reader:savePrefs': { args: { id: string; prefs: Partial<ReaderPrefs> }; result: ReaderPrefs }
  /** DOCX, TXT and Markdown rendered to HTML (unsanitized; the renderer sanitizes it). */
  'reader:html': { args: { id: string; versionId?: string }; result: { html: string } }
  'annotations:list': {
    args: { bookId: string; versionId?: string | null }
    result: Annotation[]
  }
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
  'discover:providers': { args: void; result: ProviderInfo[] }
  /** One provider at a time, so the UI can show results as each source answers. */
  'discover:search': {
    args: { provider: ProviderId; query: string }
    result: CatalogResult[]
  }
  /** Full description, subjects and the actual downloadable files. */
  'discover:details': { args: { provider: ProviderId; id: string }; result: CatalogResult }
  /** Queues a download; the book appears in the library when it finishes. Returns the job id. */
  'discover:download': {
    args: { provider: ProviderId; id: string; format: CatalogFormat['format'] }
    /** existingBookId is set (and no job started) when this item is already in the library. */
    result: { jobId: string | null; existingBookId: string | null }
  }
  'ai:chapters': { args: { bookId: string }; result: ChapterInfo[] }
  'ai:estimate': { args: AiJobRequest; result: AiEstimate }
  'ai:start': { args: AiJobRequest; result: AiJob }
  'ai:jobs': { args: { bookId?: string }; result: AiJob[] }
  'ai:part': { args: { jobId: string; idx: number }; result: AiPartDetail }
  'ai:pause': { args: { id: string }; result: void }
  'ai:resume': { args: { id: string }; result: void }
  'ai:cancel': { args: { id: string }; result: void }
  'ai:deleteJob': { args: { id: string }; result: void }
  /** Quick question about a passage; the answer streams as 'ai:delta' events with requestId. */
  'ai:ask': {
    args: { requestId: string; bookId: string; text: string; action: AskAction; context?: string }
    result: { text: string }
  }
  'ai:askCancel': { args: { requestId: string }; result: void }
  /** Saves a zip of the whole library. null when the save dialog was cancelled. */
  'backup:create': { args: void; result: { path: string; bytes: number; books: number } | null }
  /** Picks and checks a backup; nothing changes until backup:confirmRestore. null when cancelled. */
  'backup:pickRestore': {
    args: void
    result: { createdAt: string; books: number; appVersion: string } | null
  }
  /** Restarts the app; the backup replaces the library before it opens. */
  'backup:confirmRestore': { args: void; result: void }
  'backup:discardRestore': { args: void; result: void }
  /** Set right after a restore, so the UI can say where the old library was kept. */
  'backup:lastRestore': { args: void; result: { keptAt: string } | null }
  'updates:state': { args: void; result: UpdateState }
  'updates:check': { args: void; result: UpdateState }
  /** Restarts into the downloaded version. */
  'updates:install': { args: void; result: void }
  'chat:info': { args: { bookId: string }; result: ChatInfo }
  'chat:history': { args: { bookId: string }; result: ChatMessage[] }
  /** The answer streams as 'ai:delta' events with this requestId; resolves with the saved answer. */
  'chat:ask': {
    args: { requestId: string; bookId: string; question: string; location?: string }
    result: { question: ChatMessage; answer: ChatMessage }
  }
  'chat:cancel': { args: { requestId: string }; result: void }
  'chat:clear': { args: { bookId: string }; result: void }
  'versions:list': { args: { bookId: string }; result: BookVersion[] }
  'versions:rename': { args: { id: string; title: string }; result: void }
  'versions:delete': { args: { id: string }; result: void }
  'versions:export': {
    args: { id: string; format: 'pdf' | 'docx' | 'md' }
    result: { path: string } | null
  }
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
  /** Any change to an AI job (status, a part finished, tokens). */
  'ai:job': AiJob
  /** Streamed text: for a job part (jobId + idx) or a quick question (requestId). */
  'ai:delta': { jobId?: string; idx?: number; requestId?: string; text: string }
  'updates:state': UpdateState
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'jobs:update',
  'settings:changed',
  'library:changed',
  'annotations:changed',
  'ai:job',
  'ai:delta',
  'updates:state'
]

/** Every invoke goes over the wire wrapped in this envelope so errors keep a code and message. */
export type IpcEnvelope<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
