import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { BOOK_SCHEME, resolveInside, type FileStore } from './services/fileStore'

/** book://pdfjs-assets/<dir>/<file> serves pdf.js's own font, cmap and wasm files to the reader. */
export const PDFJS_ASSETS_HOST = 'pdfjs-assets'
const PDFJS_ASSET_DIRS = new Set(['standard_fonts', 'cmaps', 'wasm', 'iccs'])

function pdfjsAssetPath(url: URL): string | null {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  if (!PDFJS_ASSET_DIRS.has(rel.split('/')[0])) return null
  try {
    const root = dirname(createRequire(__filename).resolve('pdfjs-dist/package.json'))
    return resolveInside(root, rel)
  } catch {
    return null
  }
}

/** Must run before app 'ready'. */
export function registerBookSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BOOK_SCHEME,
      // corsEnabled: pdf.js loads non-http URLs with XMLHttpRequest, which Chromium only allows
      // for custom schemes that opt into CORS.
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/** Serves files from the library folder as book://<bookId>/<path>, without exposing fs to the renderer. */
export function handleBookProtocol(store: FileStore): void {
  protocol.handle(BOOK_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath =
      url.hostname === PDFJS_ASSETS_HOST ? pdfjsAssetPath(url) : store.pathFromUrl(request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(filePath).toString())
    // The app page has a file:// (opaque) origin, so CORS needs a wildcard. Only our own window
    // can load pages in this app (navigation and new windows are blocked in main).
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
