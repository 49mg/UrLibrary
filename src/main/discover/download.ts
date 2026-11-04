import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import type { CatalogFormat } from '../../shared/ipc'
import type { Fetcher } from './http'
import { USER_AGENT } from './http'

export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024

/** True if `url` is https and on one of the hosts (or a subdomain, e.g. ia800.us.archive.org). */
export function isAllowedUrl(url: string, hosts: string[]): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return hosts.some(
    (h) => u.hostname === h || u.hostname.endsWith(`.${h}`) || u.hostname === `www.${h}`
  )
}

/** Checks the first bytes so an HTML error page never gets imported as a "PDF". */
export function looksLike(format: CatalogFormat['format'], head: Uint8Array): boolean {
  const ascii = new TextDecoder('latin1').decode(head.subarray(0, 16))
  switch (format) {
    case 'pdf':
      return ascii.startsWith('%PDF-')
    case 'epub':
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 // ZIP
    case 'txt':
      return !/^\s*<(!doctype|html)/i.test(new TextDecoder().decode(head.subarray(0, 64)))
  }
}

/**
 * Streams `url` to `dest`, reporting progress (0..1, or null when the size is unknown).
 * Follows redirects, enforces a size limit, verifies the file type, and deletes partial files
 * on any failure or cancellation.
 */
export async function downloadToFile(
  fetcher: Fetcher,
  url: string,
  dest: string,
  opts: {
    format: CatalogFormat['format']
    signal: AbortSignal
    onProgress: (fraction: number | null) => void
    maxBytes?: number
  }
): Promise<{ bytes: number }> {
  const max = opts.maxBytes ?? MAX_DOWNLOAD_BYTES
  const host = new URL(url).hostname
  let res: Response
  try {
    res = await fetcher(url, { signal: opts.signal, headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    if (opts.signal.aborted) throw new Error('Cancelled', { cause: err })
    throw new Error(`Couldn’t reach ${host}: ${(err as Error).message}`, { cause: err })
  }
  if (!res.ok || !res.body) throw new Error(`${host} answered with an error (${res.status})`)
  const total = Number(res.headers.get('content-length')) || null
  if (total && total > max) throw new Error(`File is too large (${Math.round(total / 1048576)} MB)`)

  const out = createWriteStream(dest)
  const finished = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('error', reject)
  })
  let bytes = 0
  let checked = false
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!checked) {
        checked = true
        if (!looksLike(opts.format, value)) {
          await reader.cancel()
          throw new Error(
            `The server didn’t send a ${opts.format.toUpperCase()} file (got a web page instead)`
          )
        }
      }
      bytes += value.byteLength
      if (bytes > max) {
        await reader.cancel()
        throw new Error('File is larger than 500 MB')
      }
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      opts.onProgress(total ? Math.min(1, bytes / total) : null)
    }
    if (bytes === 0) throw new Error('The downloaded file is empty')
    out.end()
    await finished
    return { bytes }
  } catch (err) {
    out.destroy()
    await rm(dest, { force: true })
    if (opts.signal.aborted) throw new Error('Cancelled', { cause: err })
    throw err
  }
}
