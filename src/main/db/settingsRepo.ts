import type { Db } from './index'
import type { AppSettings, DeepPartial } from '../../shared/ipc'
import { DEFAULT_SETTINGS, mergeSettings } from '../../shared/defaults'

const KEY = 'app'

export class SettingsRepo {
  constructor(private db: Db) {}

  get(): AppSettings {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
      { value: string } | undefined
    if (!row) return DEFAULT_SETTINGS
    try {
      // Merge onto defaults so settings added in newer versions get their default values.
      return mergeSettings(DEFAULT_SETTINGS, JSON.parse(row.value) as DeepPartial<AppSettings>)
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  update(patch: DeepPartial<AppSettings>): AppSettings {
    const next = mergeSettings(this.get(), patch)
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(KEY, JSON.stringify(next))
    return next
  }
}
