import { app, net, safeStorage } from 'electron'
import { join } from 'node:path'
import { openDatabase, type Db } from './db'
import { SettingsRepo } from './db/settingsRepo'
import { BooksRepo } from './db/booksRepo'
import { CollectionsRepo } from './db/collectionsRepo'
import { SearchRepo } from './db/searchRepo'
import { AnnotationsRepo, NotebooksRepo } from './db/annotationsRepo'
import { FileStore } from './services/fileStore'
import { SecretStore } from './services/secrets'
import { JobQueue } from './services/jobQueue'
import { ImportService } from './import/importService'
import { runInWorker } from './workers/runWorker'
import { DiscoverService, SqliteCache } from './discover/service'
import { AiRepo } from './db/aiRepo'
import { AiService } from './ai/service'
import { createClaudeClient, type ClaudeClient } from './ai/claude'
import type { EventChannel, IpcEventMap } from '../shared/ipc'

/** Long-lived services shared by IPC handlers. Created once after app 'ready'. */
export interface AppContext {
  db: Db
  dbPath: string
  files: FileStore
  settings: SettingsRepo
  books: BooksRepo
  collections: CollectionsRepo
  search: SearchRepo
  annotations: AnnotationsRepo
  notebooks: NotebooksRepo
  secrets: SecretStore
  jobs: JobQueue
  /** Separate queue so downloads don't wait behind long text extractions. */
  downloads: JobQueue
  importer: ImportService
  discover: DiscoverService
  aiRepo: AiRepo
  ai: AiService
}

export type Emit = <E extends EventChannel>(event: E, payload: IpcEventMap[E]) => void

export function createContext(emit: Emit): AppContext {
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'library.db')
  const db = openDatabase(dbPath)
  const files = new FileStore(join(userData, 'library'))
  const books = new BooksRepo(db)
  // Two extractions at a time keeps bulk imports quick without starving the machine.
  const jobs = new JobQueue((job) => emit('jobs:update', job), 2)
  const importer = new ImportService({
    books,
    files,
    jobs,
    extract: (task, onProgress, signal) => runInWorker(task, onProgress, signal),
    ocrCachePath: join(userData, 'ocr-data'),
    onChanged: (bookId) => emit('library:changed', { bookId })
  })
  const settings = new SettingsRepo(db)
  // Downloads run beside imports with their own concurrency (network-bound, not CPU-bound).
  const downloads = new JobQueue((job) => emit('jobs:update', job), 3)
  const discover = new DiscoverService({
    fetcher: (url, init) => net.fetch(url, init),
    cache: new SqliteCache(db),
    books,
    settings,
    jobs: downloads,
    importer,
    downloadsDir: join(userData, 'downloads')
  })
  // No keyring at all (e.g. a minimal Linux setup): use Electron's built-in key so the API key can
  // still be saved and read. This must happen before the key is first read, or a saved key looks
  // missing after a restart. Settings shows this as "lightly protected".
  if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
    safeStorage.setUsePlainTextEncryption(true)
  }
  const secrets = new SecretStore(join(userData, 'secrets.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    isStrong: () =>
      process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text',
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  // One Claude client per key; rebuilt when the key changes.
  let cached: { key: string; client: ClaudeClient } | null = null
  const claude = (): ClaudeClient | null => {
    const key = secrets.getApiKey()
    if (!key) return null
    if (cached?.key !== key) cached = { key, client: createClaudeClient(key) }
    return cached.client
  }
  const aiRepo = new AiRepo(db)
  const ai = new AiService({
    repo: aiRepo,
    books,
    files,
    // One AI job at a time keeps costs predictable and stays under rate limits.
    queue: new JobQueue((job) => emit('jobs:update', job), 1),
    client: claude,
    effort: () => settings.get().ai.effort,
    language: () => settings.get().ai.targetLanguage,
    emitJob: (job) => emit('ai:job', job),
    emitDelta: (d) => emit('ai:delta', d),
    onVersionsChanged: (bookId) => emit('library:changed', { bookId })
  })
  return {
    db,
    dbPath,
    files,
    settings,
    books,
    collections: new CollectionsRepo(db),
    search: new SearchRepo(db),
    annotations: new AnnotationsRepo(db),
    notebooks: new NotebooksRepo(db),
    secrets,
    jobs,
    importer,
    discover,
    downloads,
    aiRepo,
    ai
  }
}
