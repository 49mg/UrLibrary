import { useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, KeyRound, Loader2, ShieldAlert } from 'lucide-react'
import type {
  ProviderInfo,
  AiEffort,
  ApiKeyStatus,
  AppInfo,
  ReaderFont,
  ReaderTheme,
  ThemePreference
} from '../../../shared/ipc'
import { Button, Field, PageHeader, Section, Segmented, inputClass } from '../components/ui'
import { useSettings } from '../stores/settings'
import { toast } from '../stores/toasts'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function ApiKeySection(): React.JSX.Element {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null)

  useEffect(() => {
    window.api.apiKey
      .status()
      .then(setStatus)
      .catch((e) => toast.error(errMsg(e)))
  }, [])

  async function run<T>(
    kind: 'save' | 'test' | 'clear',
    fn: () => Promise<T>
  ): Promise<T | undefined> {
    setBusy(kind)
    try {
      return await fn()
    } catch (e) {
      toast.error(errMsg(e))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const save = (): Promise<void> =>
    run('save', async () => {
      setStatus(await window.api.apiKey.set(draft))
      setDraft('')
      toast.success('API key saved.')
    })

  const test = (): Promise<void> =>
    run('test', async () => {
      const r = await window.api.apiKey.test()
      if (r.ok) toast.success(r.message)
      else toast.error(r.message)
    })

  const clear = (): Promise<void> =>
    run('clear', async () => {
      setStatus(await window.api.apiKey.clear())
      toast.info('API key removed.')
    })

  return (
    <>
      <Field
        label="Anthropic API key"
        htmlFor="api-key"
        hint={
          <>
            Used for AI Studio and chat. Stored encrypted on this computer and never shown again.
            Get one at{' '}
            <a
              className="text-accent underline"
              href="https://console.anthropic.com/"
              target="_blank"
              rel="noreferrer"
            >
              console.anthropic.com
            </a>
            .
          </>
        }
      >
        {status?.isSet && (
          <div className="mb-1 flex items-center gap-2 text-sm text-success">
            <CheckCircle2 size={16} aria-hidden /> Key saved (ending in …{status.hint})
          </div>
        )}
        <div className="flex gap-2">
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={status?.isSet ? 'Paste a new key to replace it' : 'sk-ant-…'}
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && draft && save()}
          />
          <Button variant="primary" onClick={save} disabled={!draft || busy !== null}>
            {busy === 'save' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <KeyRound size={16} />
            )}{' '}
            Save
          </Button>
        </div>
      </Field>
      {status?.protection === 'weak' && (
        <p className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-text">
          <ShieldAlert size={16} className="shrink-0 text-accent" aria-hidden />
          No system keyring was found, so the key is only lightly protected. Installing a keyring
          (e.g. GNOME Keyring or KWallet) gives stronger protection.
        </p>
      )}
      {status?.isSet && (
        <div className="flex gap-2">
          <Button onClick={test} disabled={busy !== null}>
            {busy === 'test' && <Loader2 size={16} className="animate-spin" />} Test key
          </Button>
          <Button variant="danger" onClick={clear} disabled={busy !== null}>
            Remove key
          </Button>
        </div>
      )}
    </>
  )
}

function SourcesList(): React.JSX.Element {
  const { settings, update } = useSettings()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  useEffect(() => {
    window.api.discover
      .providers()
      .then(setProviders)
      .catch((e) => toast.error(errMsg(e)))
  }, [])
  return (
    <ul className="flex flex-col gap-3">
      {providers.map((p) => (
        <li key={p.id}>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--c-accent)]"
              checked={settings.discover.providers[p.id] ?? false}
              onChange={(e) =>
                update({ discover: { providers: { [p.id]: e.target.checked } } }).catch((x) =>
                  toast.error(errMsg(x))
                )
              }
            />
            <span>
              <span className="text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted">{p.description}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { settings, update } = useSettings()
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.api.app
      .info()
      .then(setInfo)
      .catch((e) => toast.error(errMsg(e)))
  }, [])

  const save = (patch: Parameters<typeof update>[0]): void => {
    update(patch).catch((e) => toast.error(errMsg(e)))
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-4xl px-10">
        <Section title="Appearance">
          <Field label="App theme">
            <Segmented<ThemePreference>
              label="App theme"
              value={settings.theme}
              onChange={(theme) => save({ theme })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
            />
          </Field>
        </Section>

        <Section
          title="Reading"
          description="Defaults for new books. You can change them per book while reading."
        >
          <Field label="Page theme">
            <Segmented<ReaderTheme>
              label="Page theme"
              value={settings.reader.theme}
              onChange={(theme) => save({ reader: { theme } })}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'sepia', label: 'Sepia' },
                { value: 'dark', label: 'Dark' }
              ]}
            />
          </Field>
          <Field label="Font">
            <Segmented<ReaderFont>
              label="Font"
              value={settings.reader.fontFamily}
              onChange={(fontFamily) => save({ reader: { fontFamily } })}
              options={[
                { value: 'serif', label: 'Serif' },
                { value: 'sans', label: 'Sans-serif' }
              ]}
            />
          </Field>
          <Field label={`Font size: ${settings.reader.fontSize}px`} htmlFor="font-size">
            <input
              id="font-size"
              type="range"
              min={12}
              max={32}
              value={settings.reader.fontSize}
              onChange={(e) => save({ reader: { fontSize: Number(e.target.value) } })}
              className="w-64 accent-[var(--c-accent)]"
            />
          </Field>
          <p
            className="max-w-prose rounded-lg border border-border bg-surface p-4"
            style={{
              fontFamily:
                settings.reader.fontFamily === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
              fontSize: settings.reader.fontSize,
              lineHeight: settings.reader.lineHeight
            }}
          >
            It was a bright cold day in April, and the library smelled of paper and dust.
          </p>
        </Section>

        <Section title="AI" description="Uses Claude through your own Anthropic API key.">
          <ApiKeySection />
          <Field
            label="Default effort"
            hint="Higher effort gives more careful rewrites but costs more and takes longer."
          >
            <Segmented<AiEffort>
              label="Default effort"
              value={settings.ai.effort}
              onChange={(effort) => save({ ai: { effort } })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' }
              ]}
            />
          </Field>
          <Field label="Default translation language" htmlFor="target-lang">
            <input
              id="target-lang"
              // Re-mounts when the saved value changes, so no state sync effect is needed.
              key={settings.ai.targetLanguage}
              className={`${inputClass} max-w-xs`}
              defaultValue={settings.ai.targetLanguage}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== settings.ai.targetLanguage) save({ ai: { targetLanguage: v } })
                else e.target.value = settings.ai.targetLanguage
              }}
            />
          </Field>
        </Section>

        <Section
          title="Sources"
          description="Where Discover looks for free books. Only public-domain and openly licensed books are offered."
        >
          <SourcesList />
        </Section>

        <Section title="Storage" description="Where your books and notes live on this computer.">
          <Field label="Library folder">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-sunken px-3 py-2 text-xs">
                {info?.libraryPath ?? '…'}
              </code>
              <Button
                onClick={() => window.api.library.openFolder().catch((e) => toast.error(errMsg(e)))}
              >
                <FolderOpen size={16} aria-hidden /> Open
              </Button>
            </div>
          </Field>
          {info && (
            <p className="text-xs text-muted">
              Version {info.version} · Database: {info.dbPath}
            </p>
          )}
        </Section>
      </div>
    </>
  )
}
