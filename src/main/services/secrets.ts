import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { ApiKeyStatus } from '../../shared/ipc'

/** Thin seam over Electron's safeStorage so this module can be tested without Electron. */
export interface Encryptor {
  isAvailable(): boolean
  /** true when the OS keychain is in use; false for Electron's hardcoded-password fallback */
  isStrong(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

interface SecretsFile {
  anthropicApiKey?: string // base64 of encrypted bytes
}

export class SecretStore {
  constructor(
    private filePath: string,
    private enc: Encryptor
  ) {}

  private read(): SecretsFile {
    if (!existsSync(this.filePath)) return {}
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as SecretsFile
    } catch {
      return {}
    }
  }

  private write(data: SecretsFile): void {
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
    renameSync(tmp, this.filePath)
  }

  /** Only for use inside the main process (AI service). Never send over IPC. */
  getApiKey(): string | null {
    const stored = this.read().anthropicApiKey
    if (!stored) return null
    try {
      return this.enc.decrypt(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  setApiKey(key: string): ApiKeyStatus {
    if (!this.enc.isAvailable()) throw new Error('Secure storage is not available on this system')
    this.write({ ...this.read(), anthropicApiKey: this.enc.encrypt(key.trim()).toString('base64') })
    return this.status()
  }

  clearApiKey(): ApiKeyStatus {
    const data = this.read()
    delete data.anthropicApiKey
    if (Object.keys(data).length === 0) rmSync(this.filePath, { force: true })
    else this.write(data)
    return this.status()
  }

  status(): ApiKeyStatus {
    const key = this.getApiKey()
    return {
      isSet: key !== null,
      hint: key ? key.slice(-4) : null,
      protection: !this.enc.isAvailable() ? 'none' : this.enc.isStrong() ? 'os' : 'weak'
    }
  }
}
