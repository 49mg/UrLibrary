import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CatalogFormat, CatalogResult, ProviderId, ProviderInfo } from '../../shared/ipc'
import type { BooksRepo } from '../db/booksRepo'
import type { SettingsRepo } from '../db/settingsRepo'
import type { JobQueue } from '../services/jobQueue'
import type { ImportService } from '../import/importService'
import type { Db } from '../db'
import { AppError } from '../ipc/handler'
import { Http, MemoryCache, type Fetcher, type HttpCache } from './http'
import type { CatalogProvider, ProviderResult } from './types'
import { downloadToFile, isAllowedUrl } from './download'
import { gutenberg } from './providers/gutenberg'
import { standardebooks } from './providers/standardebooks'
import { openlibrary } from './providers/openlibrary'
import { archive } from './providers/archive'
import { arxiv } from './providers/arxiv'

/** HTTP responses cached in SQLite (fronted by memory) so repeat searches are instant and offline-tolerant. */
export class SqliteCache implements HttpCache {
  private mem = new MemoryCache(200)
  constructor(private db: Db) {}
  get(url: string, maxAgeMs: number): string | null {
    const hit = this.mem.get(url, maxAgeMs)
    if (hit !== null) return hit
    const r = this.db.prepare('SELECT body, fetched_at FROM http_cache WHERE url = ?').get(url) as
      { body: string; fetched_at: number } | undefined
    if (!r || Date.now() - r.fetched_at > maxAgeMs) return null
    return r.body
  }
  set(url: string, body: string): void {
    this.mem.set(url, body)
    this.db
      .prepare(
        `INSERT INTO http_cache (url, body, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`
      )
      .run(url, body, Date.now())
    // Keep the cache bounded: drop entries older than a week now and then.
    if (Math.random() < 0.02) {
      this.db
        .prepare('DELETE FROM http_cache WHERE fetched_at < ?')
        .run(Date.now() - 7 * 24 * 3600e3)
    }
  }
}

export interface DiscoverDeps {
  fetcher: Fetcher
  cache?: HttpCache
  books: BooksRepo
  settings: SettingsRepo
  jobs: JobQueue
  importer: ImportService
  /** Temp folder for in-progress downloads. */
  downloadsDir: string
  /** Override providers in tests. */
  providers?: CatalogProvider[]
}

const EXT: Record<CatalogFormat['format'], string> = { epub: 'epub', pdf: 'pdf', txt: 'txt' }

export class DiscoverService {
  private providers: Map<ProviderId, CatalogProvider>

  constructor(private d: DiscoverDeps) {
    const http = new Http(d.fetcher, d.cache)
    const list =
      d.providers ?? [gutenberg, standardebooks, openlibrary, archive, arxiv].map((f) => f(http))
    this.providers = new Map(list.map((p) => [p.id, p]))
  }

  info(): ProviderInfo[] {
    const enabled = this.d.settings.get().discover.providers
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      searchable: p.searchable,
      enabled: enabled[p.id] ?? false
    }))
  }

  private provider(id: ProviderId): CatalogProvider {
    const p = this.providers.get(id)
    if (!p) throw new AppError('UNKNOWN_SOURCE', 'Unknown source.')
    return p
  }

  private withLibrary(r: ProviderResult): CatalogResult {
    return { ...r, inLibraryBookId: this.d.books.findBySource(r.provider, r.id)?.id ?? null }
  }

  /** Empty query = the provider's "browse" list (popular / new). */
  async search(id: ProviderId, query: string, signal?: AbortSignal): Promise<CatalogResult[]> {
    const p = this.provider(id)
    if (!this.d.settings.get().discover.providers[id]) return []
    const q = query.trim()
    try {
      const results = q ? await p.search(q, signal) : ((await p.browse?.(signal)) ?? [])
      return results.map((r) => this.withLibrary(r))
    } catch (err) {
      throw new AppError('SOURCE_FAILED', (err as Error).message)
    }
  }

  async details(id: ProviderId, itemId: string, signal?: AbortSignal): Promise<CatalogResult> {
    try {
      return this.withLibrary(await this.provider(id).details(itemId, signal))
    } catch (err) {
      throw new AppError('SOURCE_FAILED', (err as Error).message)
    }
  }

  /**
   * Queues a download that lands in the library. If this exact catalog item is already there,
   * no job is created and the existing book id is returned.
   */
  async download(
    providerId: ProviderId,
    itemId: string,
    format: CatalogFormat['format']
  ): Promise<{ jobId: string | null; existingBookId: string | null }> {
    const p = this.provider(providerId)
    const existing = this.d.books.findBySource(providerId, itemId)
    if (existing) return { jobId: null, existingBookId: existing.id }
    const item = await this.details(providerId, itemId)
    if (!item.formats.some((f) => f.format === format)) {
      throw new AppError('NO_FORMAT', `${format.toUpperCase()} isn’t available for this book.`)
    }
    const job = this.d.jobs.add('download', `Downloading “${item.title}”`, async (ctx) => {
      ctx.progress(null)
      const { url } = await p.resolveDownload(itemId, format, ctx.signal)
      // URLs are resolved here in main, but still double-check where we are about to connect.
      if (!isAllowedUrl(url, p.allowedHosts))
        throw new Error('Refused to download from an unexpected website')
      await mkdir(this.d.downloadsDir, { recursive: true })
      const tmp = join(this.d.downloadsDir, `${randomUUID()}.${EXT[format]}.part`)
      try {
        await downloadToFile(this.d.fetcher, url, tmp, {
          format,
          signal: ctx.signal,
          onProgress: (f) => ctx.progress(f)
        })
        await this.d.importer.importDownloaded(tmp, {
          format,
          title: item.title,
          author: item.authors.join(', ') || null,
          source: providerId,
          sourceId: itemId,
          license: item.license,
          originalName: `${item.title}.${EXT[format]}`
        })
      } finally {
        await rm(tmp, { force: true })
      }
    })
    return { jobId: job.id, existingBookId: null }
  }
}
