import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  readFileSync,
  createWriteStream
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  strFromU8,
  strToU8
} from 'fflate'
import type { Db } from '../db'
import { migrations } from '../db/migrations'
import { resolveInside } from './fileStore'

/**
 * A backup is a zip with:
 *   manifest.json   what this is and when it was made
 *   library.db      consistent snapshot of the database (VACUUM INTO)
 *   library/**      book files, covers, extracted text, AI versions
 * Not included: the API key (it's tied to this computer's keyring), downloads in progress, OCR caches.
 */
export const BACKUP_FORMAT = 1
const STAGING = 'restore-staging'
const READY = 'READY'

export interface BackupManifest {
  app: 'ur-library'
  format: number
  appVersion: string
  schemaVersion: number
  createdAt: string
  books: number
}

export interface BackupResult {
  path: string
  bytes: number
  books: number
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

const sqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`

export async function createBackup(opts: {
  db: Db
  libraryDir: string
  outPath: string
  appVersion: string
  tmpDir: string
}): Promise<BackupResult> {
  mkdirSync(opts.tmpDir, { recursive: true })
  const snapshot = join(opts.tmpDir, `backup-${process.pid}-${Date.now()}.db`)
  rmSync(snapshot, { force: true })
  opts.db.exec(`VACUUM INTO ${sqlString(snapshot)}`)
  const books = (opts.db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n
  const schemaVersion = (opts.db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version
  const manifest: BackupManifest = {
    app: 'ur-library',
    format: BACKUP_FORMAT,
    appVersion: opts.appVersion,
    schemaVersion,
    createdAt: new Date().toISOString(),
    books
  }

  // Write to a temp name first so a failed backup never leaves a half-written file behind.
  const partial = `${opts.outPath}.partial`
  const fd = openSync(partial, 'w')
  try {
    let failed: Error | null = null
    const zip = new Zip((err, chunk) => {
      if (err) failed = err
      else writeSync(fd, chunk)
    })
    const addBytes = (name: string, data: Uint8Array): void => {
      const f = new ZipDeflate(name, { level: 6 })
      zip.add(f)
      f.push(data, true)
    }
    const addFile = async (name: string, path: string, compress: boolean): Promise<void> => {
      const f = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name)
      zip.add(f)
      // Read in chunks so big books never have to fit in memory.
      for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
        f.push(chunk as Buffer)
      }
      f.push(new Uint8Array(0), true)
    }
    addBytes('manifest.json', strToU8(JSON.stringify(manifest, null, 2)))
    await addFile('library.db', snapshot, true)
    for (const file of walk(opts.libraryDir)) {
      const rel = relative(opts.libraryDir, file).split(sep).join('/')
      // Books (PDF/EPUB/images) are already compressed; text and JSON shrink a lot.
      await addFile(`library/${rel}`, file, /\.(json|txt|md|html?|xml)$/i.test(rel))
    }
    zip.end()
    if (failed) throw failed
  } catch (err) {
    closeSync(fd)
    rmSync(partial, { force: true })
    throw err
  } finally {
    rmSync(snapshot, { force: true })
  }
  closeSync(fd)
  renameSync(partial, opts.outPath)
  return { path: opts.outPath, bytes: statSync(opts.outPath).size, books }
}

/**
 * Unpacks a backup into userData/restore-staging and checks it. Nothing in the live library is touched;
 * the swap happens at the next start (applyPendingRestore), once the database is no longer open.
 */
export async function stageRestore(zipPath: string, userData: string): Promise<BackupManifest> {
  const staging = join(userData, STAGING)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    await new Promise<void>((resolve, reject) => {
      const pending = new Set<string>()
      let ended = false
      let failed = false
      const fail = (e: unknown): void => {
        if (failed) return
        failed = true
        reject(e instanceof Error ? e : new Error(String(e)))
      }
      const done = (): void => {
        if (ended && pending.size === 0 && !failed) resolve()
      }
      const unzip = new Unzip((file) => {
        if (failed) return
        const name = file.name
        if (name.endsWith('/')) return // directory entry
        let target: string
        try {
          if (name !== 'manifest.json' && name !== 'library.db' && !name.startsWith('library/')) {
            throw new Error(`Unexpected file in backup: ${name}`)
          }
          // Rejects absolute paths and "..", so a crafted zip can't write outside the staging folder.
          target = resolveInside(staging, name)
        } catch (e) {
          return fail(e)
        }
        mkdirSync(dirname(target), { recursive: true })
        const out = createWriteStream(target)
        pending.add(name)
        out.on('error', fail)
        out.on('finish', () => {
          pending.delete(name)
          done()
        })
        file.ondata = (err, chunk, final) => {
          if (err) return fail(err)
          out.write(chunk)
          if (final) out.end()
        }
        file.start()
      })
      unzip.register(UnzipPassThrough)
      unzip.register(UnzipInflate)
      const input = createReadStream(zipPath, { highWaterMark: 1 << 20 })
      input.on('data', (chunk) => {
        try {
          unzip.push(chunk as Buffer)
        } catch (e) {
          fail(e)
        }
      })
      input.on('error', fail)
      input.on('end', () => {
        try {
          unzip.push(new Uint8Array(0), true)
        } catch (e) {
          return fail(e)
        }
        ended = true
        done()
      })
    })

    const manifestPath = join(staging, 'manifest.json')
    if (!existsSync(manifestPath) || !existsSync(join(staging, 'library.db'))) {
      throw new Error('This file isn’t an Ur Library backup.')
    }
    const manifest = JSON.parse(strFromU8(readFileSync(manifestPath))) as BackupManifest
    if (manifest.app !== 'ur-library') throw new Error('This file isn’t an Ur Library backup.')
    if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > migrations.length) {
      throw new Error(
        'This backup was made by a newer version of Ur Library. Update the app first.'
      )
    }
    const check = new DatabaseSync(join(staging, 'library.db'), { readOnly: true })
    try {
      const ok = check.prepare('PRAGMA quick_check').get() as { quick_check: string }
      if (ok.quick_check !== 'ok') throw new Error('The database in this backup is damaged.')
    } finally {
      check.close()
    }
    return manifest
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    if (err instanceof SyntaxError)
      throw new Error('This file isn’t an Ur Library backup.', { cause: err })
    // fflate's errors carry a numeric code (bad zip, truncated data …).
    if (typeof (err as { code?: unknown }).code === 'number') {
      throw new Error('This file isn’t a valid backup (the zip couldn’t be read).', {
        cause: err
      })
    }
    throw err
  }
}

/** Marks the staged backup to be applied on the next start. */
export function confirmRestore(userData: string): void {
  const staging = join(userData, STAGING)
  if (!existsSync(join(staging, 'manifest.json')))
    throw new Error('No backup is waiting to be restored.')
  writeFileSync(join(staging, READY), '')
}

export function discardRestore(userData: string): void {
  rmSync(join(userData, STAGING), { recursive: true, force: true })
}

/**
 * Runs at startup before the database is opened. Moves the current library aside (kept as
 * "before-restore-<date>", only the latest one) and puts the backup in its place.
 * Returns the folder the old library was moved to, or null if there was nothing to restore.
 */
export function applyPendingRestore(userData: string, now = new Date()): string | null {
  const staging = join(userData, STAGING)
  if (!existsSync(staging)) return null
  if (!existsSync(join(staging, READY))) {
    // Staged but never confirmed (e.g. the app quit while the dialog was open).
    rmSync(staging, { recursive: true, force: true })
    return null
  }
  for (const e of readdirSync(userData)) {
    if (e.startsWith('before-restore-')) rmSync(join(userData, e), { recursive: true, force: true })
  }
  const keep = join(userData, `before-restore-${now.toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(keep, { recursive: true })
  for (const name of ['library.db', 'library.db-wal', 'library.db-shm', 'library']) {
    const p = join(userData, name)
    if (existsSync(p)) renameSync(p, join(keep, name))
  }
  renameSync(join(staging, 'library.db'), join(userData, 'library.db'))
  if (existsSync(join(staging, 'library')))
    renameSync(join(staging, 'library'), join(userData, 'library'))
  else mkdirSync(join(userData, 'library'), { recursive: true })
  rmSync(staging, { recursive: true, force: true })
  return keep
}
