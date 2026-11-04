import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { openDatabase, type Db } from './db'
import { SettingsRepo } from './db/settingsRepo'
import { BooksRepo } from './db/booksRepo'
import { FileStore } from './services/fileStore'
import { SecretStore } from './services/secrets'

/** Long-lived services shared by IPC handlers. Created once after app 'ready'. */
export interface AppContext {
  db: Db
  dbPath: string
  files: FileStore
  settings: SettingsRepo
  books: BooksRepo
  secrets: SecretStore
}

export function createContext(): AppContext {
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'library.db')
  const db = openDatabase(dbPath)
  return {
    db,
    dbPath,
    files: new FileStore(join(userData, 'library')),
    settings: new SettingsRepo(db),
    books: new BooksRepo(db),
    secrets: new SecretStore(join(userData, 'secrets.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      isStrong: () =>
        process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text',
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    })
  }
}
