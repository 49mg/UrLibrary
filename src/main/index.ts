import {
  app,
  shell,
  BrowserWindow,
  dialog,
  nativeTheme,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { annotationsToMarkdown } from './export/markdown'
import { annotatePdf } from './export/pdf'
import { markdownToDocx, versionHtml } from './export/version'
import { renderMarkdown } from './import/markdown'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc/register'
import { handleBookProtocol, registerBookSchemePrivileges } from './protocol'
import { testApiKey } from './services/apiKeyTester'
import { AppError } from './ipc/handler'
import type { BookDetails, BookVersion, EventChannel, IpcEventMap } from '../shared/ipc'
import { effectiveReaderPrefs } from '../shared/defaults'
import { runInWorker } from './workers/runWorker'

registerBookSchemePrivileges()
preferSystemKeyring()

/**
 * Chromium only auto-detects the Linux keyring on desktops it knows (GNOME, KDE…). On others
 * (i3, Sway, …) it silently falls back to a weak built-in store, even when gnome-keyring or another
 * Secret Service provider is running. Ask for libsecret explicitly unless the user chose a store.
 */
function preferSystemKeyring(): void {
  if (process.platform !== 'linux' || app.commandLine.hasSwitch('password-store')) return
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase()
  if (desktop.includes('KDE')) return // KWallet is detected correctly on KDE
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
}

let mainWindow: BrowserWindow | null = null

function createWindow(ctx: AppContext): BrowserWindow {
  const theme = ctx.settings.get().theme
  nativeTheme.themeSource = theme
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Ur Library',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16140f' : '#f7f4ee',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // External links open in the system browser; the app never opens new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Block in-app navigation away from our renderer.
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!(devUrl && url.startsWith(devUrl))) e.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** A version as the renderer sees it (no file system path). */
function publicVersion(v: BookVersion & { filePath: string }): BookVersion {
  const { id, bookId, kind, title, model, createdAt, inputTokens, outputTokens } = v
  return { id, bookId, kind, title, model, createdAt, inputTokens, outputTokens }
}

/** Renders HTML in a hidden, sandboxed window and prints it to PDF. */
async function printHtmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false
    }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    })
  } finally {
    win.destroy()
  }
}

async function saveDialog(opts: SaveDialogOptions): Promise<string | null> {
  const res = mainWindow
    ? await dialog.showSaveDialog(mainWindow, opts)
    : await dialog.showSaveDialog(opts)
  return res.canceled || !res.filePath ? null : res.filePath
}

/** A title usable as a file name on every OS. */
function safeFileName(title: string): string {
  return (
    title
      // Characters invalid in file names on Windows/macOS/Linux, including control characters.
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Book'
  )
}

export function sendEvent<E extends EventChannel>(event: E, payload: IpcEventMap[E]): void {
  mainWindow?.webContents.send(event, payload)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.urlibrary.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const ctx = createContext(sendEvent)
  handleBookProtocol(ctx.files)

  const requireBook = (id: string): BookDetails => {
    const book = ctx.books.get(id)
    if (!book) throw new AppError('NOT_FOUND', 'That book is no longer in your library.')
    return book
  }
  const emitLibraryChanged = (bookId?: string): void => sendEvent('library:changed', { bookId })

  registerIpc({
    'app:info': () => ({
      version: app.getVersion(),
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      libraryPath: ctx.files.root,
      dbPath: ctx.dbPath
    }),
    'settings:get': () => ctx.settings.get(),
    'settings:update': (patch) => {
      const next = ctx.settings.update(patch)
      nativeTheme.themeSource = next.theme
      sendEvent('settings:changed', next)
      return next
    },
    'apiKey:status': () => ctx.secrets.status(),
    'apiKey:set': ({ key }) => {
      if (!key.startsWith('sk-ant-'))
        throw new AppError('INVALID_KEY', 'Anthropic API keys start with "sk-ant-".')
      try {
        return ctx.secrets.setApiKey(key)
      } catch (err) {
        throw new AppError('NO_SECURE_STORAGE', (err as Error).message)
      }
    },
    'apiKey:clear': () => ctx.secrets.clearApiKey(),
    'apiKey:test': () => testApiKey(ctx.secrets.getApiKey()),
    'books:list': () => ctx.books.list(),
    'books:get': ({ id }) => requireBook(id),
    'books:update': (patch) => {
      requireBook(patch.id)
      ctx.books.update(patch)
      emitLibraryChanged(patch.id)
      return requireBook(patch.id)
    },
    'books:delete': async ({ id }) => {
      requireBook(id)
      await ctx.importer.deleteBook(id)
    },
    'books:showInFolder': ({ id }) => {
      const info = ctx.books.getFileInfo(id)
      if (!info) throw new AppError('NOT_FOUND', 'That book is no longer in your library.')
      shell.showItemInFolder(ctx.files.resolveInBook(id, info.filePath))
    },
    'books:reextract': ({ id }) => {
      requireBook(id)
      if (ctx.jobs.hasActiveJob(id))
        throw new AppError('BUSY', 'This book is already being processed.')
      ctx.importer.queueExtraction(id)
      emitLibraryChanged(id)
    },
    'books:runOcr': ({ id, language }) => {
      const book = requireBook(id)
      if (book.format !== 'pdf') throw new AppError('UNSUPPORTED', 'OCR works on PDF files only.')
      if (ctx.jobs.hasActiveJob(id))
        throw new AppError('BUSY', 'This book is already being processed.')
      ctx.importer.queueOcr(id, language)
    },
    'reader:open': ({ id, versionId }) => {
      const book = requireBook(id)
      const info = ctx.books.getFileInfo(id)
      const version = versionId ? ctx.aiRepo.version(versionId) : null
      if (versionId && (!version || version.bookId !== id)) {
        throw new AppError('NOT_FOUND', 'That version no longer exists.')
      }
      // Reading an AI version doesn't touch the original book's reading position.
      const saved = version ? { location: null, prefs: {} } : ctx.books.open(id)
      if (!info || !saved)
        throw new AppError('NOT_FOUND', 'That book is no longer in your library.')
      if (!version) emitLibraryChanged(id)
      return {
        book: version ? { ...book, format: 'md' as const } : book,
        versions: ctx.aiRepo.versions(id),
        version: version ? publicVersion(version) : null,
        fileUrl: `book://${id}/${version ? version.filePath : info.filePath}`,
        location: saved.location,
        prefs: effectiveReaderPrefs(
          ctx.settings.get().reader,
          version ? ctx.books.open(id)?.prefs : saved.prefs
        )
      }
    },
    'reader:saveProgress': ({ id, location, progress }) => {
      const before = ctx.books.get(id)
      const status = ctx.books.saveProgress(id, location, progress)
      if (!status) throw new AppError('NOT_FOUND', 'That book is no longer in your library.')
      // Refresh library views only on visible changes, not on every page turn.
      if (!before || before.status !== status || Math.abs(before.progress - progress) >= 0.01) {
        emitLibraryChanged(id)
      }
      return { status }
    },
    'reader:savePrefs': ({ id, prefs }) => {
      requireBook(id)
      return effectiveReaderPrefs(ctx.settings.get().reader, ctx.books.saveReaderPrefs(id, prefs))
    },
    'reader:html': async ({ id, versionId }) => {
      if (versionId) {
        const v = await ctx.ai.versionMarkdown(versionId)
        if (v.bookId !== id) throw new AppError('NOT_FOUND', 'That version no longer exists.')
        return { html: renderMarkdown(v.markdown) }
      }
      const info = ctx.books.getFileInfo(id)
      if (!info) throw new AppError('NOT_FOUND', 'That book is no longer in your library.')
      if (info.format === 'pdf' || info.format === 'epub') {
        throw new AppError('UNSUPPORTED', 'This format has its own reader.')
      }
      try {
        return await runInWorker(
          {
            type: 'html',
            filePath: ctx.files.resolveInBook(id, info.filePath),
            format: info.format
          },
          () => undefined,
          new AbortController().signal
        )
      } catch (err) {
        throw new AppError('RENDER_FAILED', `Couldn’t open this file: ${(err as Error).message}`)
      }
    },
    'annotations:list': ({ bookId, versionId }) => ctx.annotations.list(bookId, versionId ?? null),
    'annotations:create': (a) => {
      requireBook(a.bookId)
      const created = ctx.annotations.create(a)
      sendEvent('annotations:changed', { bookId: a.bookId })
      return created
    },
    'annotations:update': ({ id, ...patch }) => {
      const updated = ctx.annotations.update(id, patch)
      if (!updated) throw new AppError('NOT_FOUND', 'That note was already deleted.')
      sendEvent('annotations:changed', { bookId: updated.bookId })
      return updated
    },
    'annotations:delete': ({ id }) => {
      const bookId = ctx.annotations.delete(id)
      if (bookId) sendEvent('annotations:changed', { bookId })
    },
    'annotations:search': (opts) => ctx.annotations.search(opts),
    'notebook:get': ({ bookId }) => ctx.notebooks.get(bookId),
    'notebook:save': ({ bookId, content }) => {
      requireBook(bookId)
      return ctx.notebooks.save(bookId, content)
    },
    'export:markdown': async ({ bookId }) => {
      const book = requireBook(bookId)
      const res = await saveDialog({
        title: 'Export notes',
        defaultPath: `${safeFileName(book.title)} — notes.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (!res) return null
      const md = annotationsToMarkdown(
        book,
        ctx.annotations.list(bookId),
        ctx.notebooks.get(bookId).content
      )
      await writeFile(res, md, 'utf8')
      return { path: res }
    },
    'export:annotatedPdf': async ({ bookId }) => {
      const book = requireBook(bookId)
      const info = ctx.books.getFileInfo(bookId)
      if (!info || info.format !== 'pdf')
        throw new AppError('UNSUPPORTED', 'Only PDF books can be exported with highlights.')
      const res = await saveDialog({
        title: 'Export PDF with highlights',
        defaultPath: `${safeFileName(book.title)} (annotated).pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (!res) return null
      const original = await readFile(ctx.files.resolveInBook(bookId, info.filePath))
      await writeFile(
        res,
        await annotatePdf(new Uint8Array(original), ctx.annotations.list(bookId))
      )
      return { path: res }
    },
    'discover:providers': () => ctx.discover.info(),
    'discover:search': ({ provider, query }) => ctx.discover.search(provider, query),
    'discover:details': ({ provider, id }) => ctx.discover.details(provider, id),
    'discover:download': ({ provider, id, format }) => ctx.discover.download(provider, id, format),
    'ai:chapters': ({ bookId }) => ctx.ai.chapters(bookId),
    'ai:estimate': (req) => ctx.ai.estimate(req),
    'ai:start': (req) => ctx.ai.start(req),
    'ai:jobs': ({ bookId }) => ctx.ai.jobs(bookId),
    'ai:part': ({ jobId, idx }) => {
      const p = ctx.aiRepo.part(jobId, idx)
      if (!p) throw new AppError('NOT_FOUND', 'That part no longer exists.')
      return p
    },
    'ai:pause': ({ id }) => ctx.ai.pause(id),
    'ai:resume': ({ id }) => ctx.ai.resume(id),
    'ai:cancel': ({ id }) => ctx.ai.cancel(id),
    'ai:deleteJob': ({ id }) => ctx.ai.deleteJob(id),
    'ai:ask': ({ requestId, bookId, text, action, context }) =>
      ctx.ai.ask(requestId, bookId, text, action, context),
    'ai:askCancel': ({ requestId }) => ctx.ai.cancelAsk(requestId),
    'versions:list': ({ bookId }) => ctx.aiRepo.versions(bookId),
    'versions:rename': ({ id, title }) => {
      const v = ctx.aiRepo.version(id)
      if (!v) throw new AppError('NOT_FOUND', 'That version no longer exists.')
      ctx.aiRepo.renameVersion(id, title)
      emitLibraryChanged(v.bookId)
    },
    'versions:delete': ({ id }) => ctx.ai.deleteVersion(id),
    'versions:export': async ({ id, format }) => {
      const v = await ctx.ai.versionMarkdown(id)
      const book = ctx.books.get(v.bookId)
      const name = safeFileName(`${book?.title ?? 'Book'} — ${v.title}`)
      const res = await saveDialog({
        title: 'Export version',
        defaultPath: `${name}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
      })
      if (!res) return null
      if (format === 'md') await writeFile(res, v.markdown, 'utf8')
      else if (format === 'docx') await writeFile(res, await markdownToDocx(v.title, v.markdown))
      else await writeFile(res, await printHtmlToPdf(versionHtml(v.title, v.markdown)))
      return { path: res }
    },
    'library:openFolder': async () => {
      const err = await shell.openPath(ctx.files.root)
      if (err) throw new AppError('OPEN_FAILED', err)
    },
    'library:importDialog': async ({ mode }) => {
      const opts: OpenDialogOptions =
        mode === 'folder'
          ? { title: 'Import a folder of books', properties: ['openDirectory'] }
          : {
              title: 'Import books',
              properties: ['openFile', 'multiSelections'],
              filters: [
                { name: 'Books', extensions: ['pdf', 'epub', 'docx', 'txt', 'md', 'markdown'] }
              ]
            }
      const res = mainWindow
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts)
      if (res.canceled || res.filePaths.length === 0) return null
      return ctx.importer.importPaths(res.filePaths)
    },
    'library:importPaths': ({ paths }) => ctx.importer.importPaths(paths),
    'search:fullText': ({ query, limit }) => {
      const q = query.trim()
      if (q.length < 2) return { books: [], hits: [] }
      const ids = new Set(ctx.search.matchBookIds(q))
      return {
        books: ctx.books.list().filter((b) => ids.has(b.id)),
        hits: ctx.search.fullText(q, limit ?? 50)
      }
    },
    'collections:list': () => ctx.collections.list(),
    'collections:create': ({ name }) => {
      const c = ctx.collections.create(name)
      emitLibraryChanged()
      return c
    },
    'collections:rename': ({ id, name }) => {
      ctx.collections.rename(id, name)
      emitLibraryChanged()
    },
    'collections:delete': ({ id }) => {
      ctx.collections.delete(id)
      emitLibraryChanged()
    },
    'collections:addBook': ({ collectionId, bookId }) => {
      ctx.collections.addBook(collectionId, bookId)
      emitLibraryChanged(bookId)
    },
    'collections:removeBook': ({ collectionId, bookId }) => {
      ctx.collections.removeBook(collectionId, bookId)
      emitLibraryChanged(bookId)
    },
    'jobs:list': () => [...ctx.jobs.list(), ...ctx.downloads.list()],
    'jobs:cancel': ({ id }) => {
      ctx.jobs.cancel(id)
      ctx.downloads.cancel(id)
    }
  })

  mainWindow = createWindow(ctx)
  ctx.importer.resumeInterrupted()
  ctx.ai.resumeInterrupted()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(ctx)
  })
  app.on('will-quit', () => ctx.db.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
