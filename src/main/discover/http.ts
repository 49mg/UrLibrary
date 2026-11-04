/** Minimal fetch signature so tests can use plain `fetch` and the app can use Electron's `net.fetch`. */
export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<Response>

/** Identifies the app politely to catalogs, without personal data. */
export const USER_AGENT = 'UrLibrary/1.0 (desktop e-book reader)'

const TIMEOUT_MS = 20_000

export interface HttpCache {
  get(url: string, maxAgeMs: number): string | null
  set(url: string, body: string): void
}

/** Small in-memory cache, used in tests and as a front for the SQLite cache. */
export class MemoryCache implements HttpCache {
  private map = new Map<string, { body: string; at: number }>()
  constructor(private max = 300) {}
  get(url: string, maxAgeMs: number): string | null {
    const hit = this.map.get(url)
    if (!hit || Date.now() - hit.at > maxAgeMs) return null
    return hit.body
  }
  set(url: string, body: string): void {
    this.map.delete(url)
    this.map.set(url, { body, at: Date.now() })
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
  }
}

export function withTimeout(signal: AbortSignal | undefined, ms = TIMEOUT_MS): AbortSignal {
  const t = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, t]) : t
}

/** GET text with caching, a timeout and readable errors. */
export class Http {
  constructor(
    private fetcher: Fetcher,
    private cache: HttpCache = new MemoryCache()
  ) {}

  async text(url: string, opts: { signal?: AbortSignal; maxAgeMs?: number } = {}): Promise<string> {
    const maxAge = opts.maxAgeMs ?? 60 * 60 * 1000
    const cached = this.cache.get(url, maxAge)
    if (cached !== null) return cached
    const host = new URL(url).hostname
    let res: Response
    try {
      res = await this.fetcher(url, {
        signal: withTimeout(opts.signal),
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }
      })
    } catch (err) {
      if (opts.signal?.aborted) throw err
      const timedOut = (err as Error).name === 'TimeoutError'
      throw new HttpError(timedOut ? `${host} didn’t respond in time` : `Couldn’t reach ${host}`)
    }
    if (!res.ok) throw new HttpError(`${host} answered with an error (${res.status})`, res.status)
    const body = await res.text()
    this.cache.set(url, body)
    return body
  }

  async json<T>(url: string, opts: { signal?: AbortSignal; maxAgeMs?: number } = {}): Promise<T> {
    const body = await this.text(url, opts)
    try {
      return JSON.parse(body) as T
    } catch {
      throw new HttpError(`${new URL(url).hostname} sent an unexpected response`)
    }
  }
}
