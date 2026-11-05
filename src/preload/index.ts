import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  type CatalogFormat,
  type ProviderId,
  type EventChannel,
  type InvokeArgs,
  type InvokeChannel,
  type InvokeResult,
  type IpcEnvelope,
  type IpcEventMap
} from '../shared/ipc'

async function invoke<K extends InvokeChannel>(
  channel: K,
  args?: InvokeArgs<K>
): Promise<InvokeResult<K>> {
  const res = (await ipcRenderer.invoke(channel, args)) as IpcEnvelope<InvokeResult<K>>
  if (res.ok) return res.data
  // Errors crossing contextBridge keep only their message, so the UI shows `message` as-is.
  const err = new Error(res.error.message)
  err.name = res.error.code
  throw err
}

function on<E extends EventChannel>(event: E, cb: (payload: IpcEventMap[E]) => void): () => void {
  if (!EVENT_CHANNELS.includes(event)) throw new Error(`Unknown event: ${event}`)
  const listener = (_e: IpcRendererEvent, payload: IpcEventMap[E]): void => cb(payload)
  ipcRenderer.on(event, listener)
  return () => ipcRenderer.removeListener(event, listener)
}

const api = {
  app: {
    info: () => invoke('app:info')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch: InvokeArgs<'settings:update'>) => invoke('settings:update', patch)
  },
  apiKey: {
    status: () => invoke('apiKey:status'),
    set: (key: string) => invoke('apiKey:set', { key }),
    clear: () => invoke('apiKey:clear'),
    test: () => invoke('apiKey:test')
  },
  books: {
    list: () => invoke('books:list'),
    get: (id: string) => invoke('books:get', { id }),
    update: (patch: InvokeArgs<'books:update'>) => invoke('books:update', patch),
    delete: (id: string) => invoke('books:delete', { id }),
    showInFolder: (id: string) => invoke('books:showInFolder', { id }),
    reextract: (id: string) => invoke('books:reextract', { id }),
    runOcr: (id: string, language: InvokeArgs<'books:runOcr'>['language']) =>
      invoke('books:runOcr', { id, language })
  },
  reader: {
    open: (id: string, versionId?: string) => invoke('reader:open', { id, versionId }),
    saveProgress: (id: string, location: string, progress: number) =>
      invoke('reader:saveProgress', { id, location, progress }),
    savePrefs: (id: string, prefs: InvokeArgs<'reader:savePrefs'>['prefs']) =>
      invoke('reader:savePrefs', { id, prefs }),
    html: (id: string, versionId?: string) => invoke('reader:html', { id, versionId })
  },
  annotations: {
    list: (bookId: string, versionId?: string | null) =>
      invoke('annotations:list', { bookId, versionId: versionId ?? null }),
    create: (a: InvokeArgs<'annotations:create'>) => invoke('annotations:create', a),
    update: (id: string, patch: Omit<InvokeArgs<'annotations:update'>, 'id'>) =>
      invoke('annotations:update', { id, ...patch }),
    delete: (id: string) => invoke('annotations:delete', { id }),
    search: (opts: InvokeArgs<'annotations:search'> = {}) => invoke('annotations:search', opts)
  },
  notebook: {
    get: (bookId: string) => invoke('notebook:get', { bookId }),
    save: (bookId: string, content: string) => invoke('notebook:save', { bookId, content })
  },
  exports: {
    markdown: (bookId: string) => invoke('export:markdown', { bookId }),
    annotatedPdf: (bookId: string) => invoke('export:annotatedPdf', { bookId })
  },
  discover: {
    providers: () => invoke('discover:providers'),
    search: (provider: ProviderId, query: string) => invoke('discover:search', { provider, query }),
    details: (provider: ProviderId, id: string) => invoke('discover:details', { provider, id }),
    download: (provider: ProviderId, id: string, format: CatalogFormat['format']) =>
      invoke('discover:download', { provider, id, format })
  },
  ai: {
    chapters: (bookId: string) => invoke('ai:chapters', { bookId }),
    estimate: (req: InvokeArgs<'ai:estimate'>) => invoke('ai:estimate', req),
    start: (req: InvokeArgs<'ai:start'>) => invoke('ai:start', req),
    jobs: (bookId?: string) => invoke('ai:jobs', { bookId }),
    part: (jobId: string, idx: number) => invoke('ai:part', { jobId, idx }),
    pause: (id: string) => invoke('ai:pause', { id }),
    resume: (id: string) => invoke('ai:resume', { id }),
    cancel: (id: string) => invoke('ai:cancel', { id }),
    deleteJob: (id: string) => invoke('ai:deleteJob', { id }),
    ask: (args: InvokeArgs<'ai:ask'>) => invoke('ai:ask', args),
    askCancel: (requestId: string) => invoke('ai:askCancel', { requestId })
  },
  updates: {
    state: () => invoke('updates:state'),
    check: () => invoke('updates:check'),
    install: () => invoke('updates:install')
  },
  backup: {
    create: () => invoke('backup:create'),
    pickRestore: () => invoke('backup:pickRestore'),
    confirmRestore: () => invoke('backup:confirmRestore'),
    discardRestore: () => invoke('backup:discardRestore'),
    lastRestore: () => invoke('backup:lastRestore')
  },
  chat: {
    info: (bookId: string) => invoke('chat:info', { bookId }),
    history: (bookId: string) => invoke('chat:history', { bookId }),
    ask: (args: InvokeArgs<'chat:ask'>) => invoke('chat:ask', args),
    cancel: (requestId: string) => invoke('chat:cancel', { requestId }),
    clear: (bookId: string) => invoke('chat:clear', { bookId })
  },
  versions: {
    list: (bookId: string) => invoke('versions:list', { bookId }),
    rename: (id: string, title: string) => invoke('versions:rename', { id, title }),
    delete: (id: string) => invoke('versions:delete', { id }),
    export: (id: string, format: 'pdf' | 'docx' | 'md') => invoke('versions:export', { id, format })
  },
  library: {
    openFolder: () => invoke('library:openFolder'),
    importDialog: (mode: 'files' | 'folder') => invoke('library:importDialog', { mode }),
    importPaths: (paths: string[]) => invoke('library:importPaths', { paths }),
    /** Real filesystem path of a dropped File (sandboxed renderers can't read File.path). */
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  search: {
    fullText: (query: string, limit?: number) => invoke('search:fullText', { query, limit })
  },
  collections: {
    list: () => invoke('collections:list'),
    create: (name: string) => invoke('collections:create', { name }),
    rename: (id: string, name: string) => invoke('collections:rename', { id, name }),
    delete: (id: string) => invoke('collections:delete', { id }),
    addBook: (collectionId: string, bookId: string) =>
      invoke('collections:addBook', { collectionId, bookId }),
    removeBook: (collectionId: string, bookId: string) =>
      invoke('collections:removeBook', { collectionId, bookId })
  },
  jobs: {
    list: () => invoke('jobs:list'),
    cancel: (id: string) => invoke('jobs:cancel', { id })
  },
  on
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
