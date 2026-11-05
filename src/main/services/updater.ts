import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../../shared/ipc'

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export interface UpdaterEnv {
  isPackaged: boolean
  platform: NodeJS.Platform
  version: string
  resourcesPath: string
  /** Set by the AppImage runtime; a .deb install doesn't have it. */
  appImage: string | undefined
  /** Testing/self-hosting: a generic update server URL used instead of GitHub. */
  feedUrl: string | undefined
  /** Where to write the update config when feedUrl is used (builds only ship one for GitHub). */
  configDir: string
}

/** Whether this install can update itself, and if not, why (shown in Settings). */
export function updateSupport(env: UpdaterEnv): { ok: true } | { ok: false; message: string } {
  if (!env.isPackaged) return { ok: false, message: 'Updates are off in development builds.' }
  if (env.platform === 'linux' && !env.appImage) {
    return {
      ok: false,
      message:
        'Installed from a .deb package: install the new .deb from the releases page to update.'
    }
  }
  if (!env.feedUrl && !existsSync(join(env.resourcesPath, 'app-update.yml'))) {
    return { ok: false, message: 'This build has no update source configured.' }
  }
  return { ok: true }
}

/**
 * Wraps electron-updater: checks in the background (if enabled), downloads quietly, and tells the UI
 * when a new version is ready. Installing happens on "Restart now" or the next time the app quits.
 */
export class UpdateService {
  private state: UpdateState
  private timer: NodeJS.Timeout | null = null

  constructor(
    private env: UpdaterEnv,
    private updater: () => Promise<AppUpdater>,
    private auto: () => boolean,
    private emit: (s: UpdateState) => void
  ) {
    const support = updateSupport(env)
    this.state = support.ok
      ? { status: 'idle', currentVersion: env.version }
      : { status: 'unsupported', currentVersion: env.version, message: support.message }
  }

  get(): UpdateState {
    return this.state
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit(this.state)
  }

  private wired: AppUpdater | null = null
  private async instance(): Promise<AppUpdater> {
    if (this.wired) return this.wired
    const u = await this.updater()
    u.autoDownload = true
    u.autoInstallOnAppQuit = true
    u.logger = null
    if (this.env.feedUrl) {
      // electron-updater reads app-update.yml (e.g. for its download cache folder) even with a
      // custom feed, so give it one describing that feed.
      mkdirSync(this.env.configDir, { recursive: true })
      const config = join(this.env.configDir, 'app-update.yml')
      writeFileSync(
        config,
        `provider: generic\nurl: ${JSON.stringify(this.env.feedUrl)}\nupdaterCacheDirName: ur-library-updater\n`
      )
      u.updateConfigPath = config
      u.setFeedURL({ provider: 'generic', url: this.env.feedUrl })
    }
    u.on('checking-for-update', () => this.set({ status: 'checking', message: undefined }))
    u.on('update-not-available', () =>
      this.set({ status: 'none', checkedAt: new Date().toISOString() })
    )
    u.on('update-available', (info: UpdateInfo) =>
      this.set({
        status: 'downloading',
        version: info.version,
        percent: 0,
        checkedAt: new Date().toISOString()
      })
    )
    u.on('download-progress', (p: ProgressInfo) =>
      this.set({ status: 'downloading', percent: Math.round(p.percent) })
    )
    u.on('update-downloaded', (info: UpdateInfo) =>
      this.set({ status: 'ready', version: info.version, percent: 100 })
    )
    u.on('error', (err: Error) =>
      this.set({ status: 'error', message: friendly(err), checkedAt: new Date().toISOString() })
    )
    this.wired = u
    return u
  }

  /** Starts background checks if the user has them on. */
  start(): void {
    if (this.state.status === 'unsupported') return
    const tick = (): void => {
      if (this.auto() && this.state.status !== 'ready' && this.state.status !== 'downloading')
        void this.check()
    }
    this.timer = setTimeout(() => {
      tick()
      this.timer = setInterval(tick, CHECK_EVERY_MS)
    }, FIRST_CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'unsupported') return this.state
    if (
      this.state.status === 'checking' ||
      this.state.status === 'downloading' ||
      this.state.status === 'ready'
    ) {
      return this.state
    }
    try {
      await (await this.instance()).checkForUpdates()
    } catch (err) {
      this.set({
        status: 'error',
        message: friendly(err as Error),
        checkedAt: new Date().toISOString()
      })
    }
    return this.state
  }

  async install(): Promise<void> {
    if (this.state.status !== 'ready') throw new Error('No update has been downloaded yet.')
    ;(await this.instance()).quitAndInstall(false, true)
  }
}

function friendly(err: Error): string {
  const m = err.message ?? String(err)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(m))
    return 'Couldn’t reach the update server. Check your connection.'
  if (/404|Cannot find latest|No published versions/i.test(m))
    return 'No published versions were found yet.'
  return `Update failed: ${m.split('\n')[0].slice(0, 200)}`
}
