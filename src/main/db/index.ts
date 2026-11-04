import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'

export type Db = DatabaseSync

/** Opens (or creates) the library database and brings its schema up to date. Pass ':memory:' in tests. */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  migrate(db)
  return db
}

export function migrate(db: Db): number {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  for (let i = current; i < migrations.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(migrations[i])
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${i + 1} failed: ${(err as Error).message}`, { cause: err })
    }
  }
  return migrations.length
}
