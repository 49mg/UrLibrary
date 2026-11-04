import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc/register'
import { handleBookProtocol, registerBookSchemePrivileges } from './protocol'
import { testApiKey } from './services/apiKeyTester'
import { AppError } from './ipc/handler'
import type { EventChannel, IpcEventMap } from '../shared/ipc'

registerBookSchemePrivileges()

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

export function sendEvent<E extends EventChannel>(event: E, payload: IpcEventMap[E]): void {
  mainWindow?.webContents.send(event, payload)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.urlibrary.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const ctx = createContext()
  handleBookProtocol(ctx.files)

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
    'library:openFolder': async () => {
      const err = await shell.openPath(ctx.files.root)
      if (err) throw new AppError('OPEN_FAILED', err)
    }
  })

  mainWindow = createWindow(ctx)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(ctx)
  })
  app.on('will-quit', () => ctx.db.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
