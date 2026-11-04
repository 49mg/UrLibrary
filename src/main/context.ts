import { app, safeStorage } from 'electron'
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
  importer: ImportService
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
  return {
    db,
    dbPath,
    files,
    settings: new SettingsRepo(db),
    books,
    collections: new CollectionsRepo(db),
    search: new SearchRepo(db),
    annotations: new AnnotationsRepo(db),
    notebooks: new NotebooksRepo(db),
    secrets: new SecretStore(join(userData, 'secrets.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      isStrong: () =>
        process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text',
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    }),
    jobs,
    importer
  }
}
