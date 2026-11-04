import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { BOOK_SCHEME, type FileStore } from './services/fileStore'

/** Must run before app 'ready'. */
export function registerBookSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BOOK_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** Serves files from the library folder as book://<bookId>/<path>, without exposing fs to the renderer. */
export function handleBookProtocol(store: FileStore): void {
  protocol.handle(BOOK_SCHEME, (request) => {
    const filePath = store.pathFromUrl(request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
