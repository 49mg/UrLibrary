/**
 * Single source of truth for every IPC channel between the renderer and the main process.
 * Main registers handlers for `IpcInvokeMap`, preload exposes them as `window.api`,
 * and both sides share these types so a channel can't drift out of sync.
 */

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

export interface BookSummary {
  id: string
  title: string
  author: string | null
  format: BookFormat
  source: string
  coverUrl: string | null
  addedAt: string
  progress: number
}

export type JobKind = 'import' | 'download' | 'ai' | 'ocr'
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  kind: JobKind
  label: string
  status: JobStatus
  /** 0..1, or null when indeterminate */
  progress: number | null
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
  'library:openFolder': { args: void; result: void }
}

export interface IpcEventMap {
  'jobs:update': Job
  'settings:changed': AppSettings
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<K extends InvokeChannel> = IpcInvokeMap[K]['args']
export type InvokeResult<K extends InvokeChannel> = IpcInvokeMap[K]['result']
export type EventChannel = keyof IpcEventMap

export const EVENT_CHANNELS: readonly EventChannel[] = ['jobs:update', 'settings:changed']

/** Every invoke goes over the wire wrapped in this envelope so errors keep a code and message. */
export type IpcEnvelope<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
