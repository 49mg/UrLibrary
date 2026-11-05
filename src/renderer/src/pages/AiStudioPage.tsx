import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  AlignLeft,
  BookOpenCheck,
  GraduationCap,
  HelpCircle,
  KeyRound,
  Languages,
  Loader2,
  PenLine,
  Sparkles,
  Wand2
} from 'lucide-react'
import type {
  AiAction,
  AiActionOptions,
  AiEstimate,
  AiJobRequest,
  ApiKeyStatus,
  ChapterInfo
} from '../../../shared/ipc'
import { Button, EmptyState, Field, PageHeader, Segmented, inputClass } from '../components/ui'
import { JobStatusBadge, JobView } from '../components/ai/JobView'
import { useLibrary } from '../stores/library'
import { useAi, formatTokens, formatUsd } from '../stores/ai'
import { useSettings } from '../stores/settings'
import { toast } from '../stores/toasts'
import { cn } from '../lib/cn'

const ACTIONS: Array<{ id: AiAction; name: string; desc: string; icon: typeof Sparkles }> = [
  { id: 'summarize', name: 'Summarize', desc: 'Chapter-by-chapter summaries', icon: AlignLeft },
  { id: 'simplify', name: 'Simplify', desc: 'Easier language, same story', icon: BookOpenCheck },
  { id: 'translate', name: 'Translate', desc: 'Into another language', icon: Languages },
  { id: 'rewrite', name: 'Rewrite', desc: 'In a style you choose', icon: PenLine },
  { id: 'study-notes', name: 'Study notes', desc: 'Key points and terms', icon: GraduationCap },
  { id: 'quiz', name: 'Quiz', desc: 'Questions with answers', icon: HelpCircle },
  { id: 'custom', name: 'Custom', desc: 'Your own instruction', icon: Wand2 }
]

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function Options({
  action,
  options,
  set
}: {
  action: AiAction
  options: AiActionOptions
  set: (o: AiActionOptions) => void
}): React.JSX.Element | null {
  switch (action) {
    case 'summarize':
      return (
        <Field label="Length">
          <Segmented
            label="Length"
            value={options.length ?? 'brief'}
            onChange={(length) => set({ ...options, length })}
            options={[
              { value: 'brief', label: 'Brief' },
              { value: 'detailed', label: 'Detailed' }
            ]}
          />
        </Field>
      )
    case 'simplify':
      return (
        <Field label="Reading level">
          <Segmented
            label="Reading level"
            value={options.level ?? 'plain'}
            onChange={(level) => set({ ...options, level })}
            options={[
              { value: 'child', label: 'Child' },
              { value: 'teen', label: 'Teen' },
              { value: 'plain', label: 'Plain adult' }
            ]}
          />
        </Field>
      )
    case 'translate':
      return (
        <Field label="Translate into" htmlFor="ai-lang">
          <input
            id="ai-lang"
            className={`${inputClass} max-w-60`}
            value={options.language ?? ''}
            onChange={(e) => set({ ...options, language: e.target.value })}
          />
        </Field>
      )
    case 'rewrite':
      return (
        <Field
          label="Style"
          htmlFor="ai-style"
          hint="e.g. modern English, for a 10-year-old, as a screenplay"
        >
          <input
            id="ai-style"
            className={inputClass}
            value={options.style ?? ''}
            placeholder="modern English"
            onChange={(e) => set({ ...options, style: e.target.value })}
          />
        </Field>
      )
    case 'custom':
      return (
        <Field label="Instruction" htmlFor="ai-instr" hint="Applied to every part of the book.">
          <textarea
            id="ai-instr"
            rows={3}
            className={`${inputClass} resize-y`}
            value={options.instruction ?? ''}
            placeholder="List every character introduced in this part, with a one-line description."
            onChange={(e) => set({ ...options, instruction: e.target.value })}
          />
        </Field>
      )
    default:
      return null
  }
}

export function AiStudioPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const books = useLibrary((s) => s.books)
  const ready = books.filter((b) => b.textStatus === 'done')
  const bookId = params.get('book') ?? ''
  const book = ready.find((b) => b.id === bookId) ?? null
  const readyBookId = book?.id ?? null
  const targetLanguage = useSettings((s) => s.settings.ai.targetLanguage)

  const [key, setKey] = useState<ApiKeyStatus | null>(null)
  const [action, setAction] = useState<AiAction>('summarize')
  const [options, setOptions] = useState<AiActionOptions>({})
  const [scope, setScope] = useState<'book' | 'chapters'>('book')
  const [chapters, setChapters] = useState<ChapterInfo[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [estimate, setEstimate] = useState<AiEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [openJob, setOpenJob] = useState<string | null>(null)
  const allJobs = useAi((s) => s.jobs)

  useEffect(() => {
    window.api.apiKey
      .status()
      .then(setKey)
      .catch(() => setKey(null))
  }, [])

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    window.api.ai
      .chapters(bookId)
      .then((c) => {
        if (cancelled) return
        setChapters(c)
        setPicked(new Set())
      })
      .catch(() => !cancelled && setChapters([]))
    return () => {
      cancelled = true
    }
  }, [bookId])

  const effectiveOptions = useMemo(
    () =>
      action === 'translate' && !options.language
        ? { ...options, language: targetLanguage }
        : options,
    [action, options, targetLanguage]
  )
  const request: AiJobRequest | null = (() => {
    if (!readyBookId) return null
    if (scope === 'chapters' && picked.size === 0) return null
    if (action === 'custom' && !effectiveOptions.instruction?.trim()) return null
    return {
      bookId: readyBookId,
      action,
      options: effectiveOptions,
      scope:
        scope === 'book'
          ? { kind: 'book' }
          : { kind: 'chapters', indexes: [...picked].sort((a, b) => a - b) }
    }
  })()
  // The estimate re-runs only when the request's content changes, not on every render.
  const requestKey = request ? JSON.stringify(request) : null

  // Live cost estimate as the form changes.
  useEffect(() => {
    if (!requestKey) return
    const req = JSON.parse(requestKey) as AiJobRequest
    let cancelled = false
    const t = setTimeout(() => {
      setEstimating(true)
      window.api.ai
        .estimate(req)
        .then((e) => !cancelled && setEstimate(e))
        .catch((e) => !cancelled && toast.error(err(e)))
        .finally(() => !cancelled && setEstimating(false))
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [requestKey])

  const jobs = Object.values(allJobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const active =
    (openJob && allJobs[openJob]) || jobs.find((j) => j.status === 'running') || jobs[0] || null

  const start = async (): Promise<void> => {
    if (!request) return
    setStarting(true)
    try {
      const job = await window.api.ai.start(request)
      useAi.getState().upsert(job)
      setOpenJob(job.id)
    } catch (e) {
      toast.error(err(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="AI Studio"
        subtitle="Summarize, simplify, translate or rewrite your books with Claude"
      />
      {key && !key.isSet && (
        <div className="mx-10 mt-6 flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          <KeyRound size={18} className="shrink-0 text-accent" aria-hidden />
          <span className="flex-1">
            AI Studio uses your own Anthropic API key. Add it once and it’s stored encrypted on this
            computer.
          </span>
          <Link to="/settings" className="font-medium text-accent underline">
            Add API key
          </Link>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-6 px-10 py-6">
        {/* ---- setup ---- */}
        {/* Children keep their height; the column scrolls instead of squashing them. */}
        <div className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto pr-1 [&>*]:shrink-0">
          <Field label="Book" htmlFor="ai-book">
            <select
              id="ai-book"
              className={inputClass}
              value={book?.id ?? ''}
              onChange={(e) => setParams(e.target.value ? { book: e.target.value } : {})}
            >
              <option value="">Choose a book…</option>
              {ready.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.author ? ` — ${b.author}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <div className="mb-1.5 text-sm font-medium">What should Claude do?</div>
            <div role="radiogroup" aria-label="Action" className="grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={action === a.id}
                  onClick={() => {
                    setAction(a.id)
                    setOptions({})
                  }}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border px-3 py-2 text-left',
                    action === a.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-border bg-surface hover:bg-sunken'
                  )}
                >
                  <a.icon
                    size={16}
                    className={cn(
                      'mt-0.5 shrink-0',
                      action === a.id ? 'text-accent' : 'text-muted'
                    )}
                    aria-hidden
                  />
                  <span>
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-muted">{a.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Options action={action} options={effectiveOptions} set={setOptions} />

          <Field label="Which part of the book?">
            <Segmented
              label="Scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'book', label: 'Whole book' },
                { value: 'chapters', label: 'Choose chapters' }
              ]}
            />
          </Field>
          {scope === 'chapters' && (
            <ul
              aria-label="Chapters"
              className="max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-2"
            >
              {chapters.length === 0 && (
                <li className="p-2 text-sm text-muted">Choose a book first.</li>
              )}
              {chapters.map((c) => (
                <li key={c.index}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-sunken">
                    <input
                      type="checkbox"
                      className="accent-[var(--c-accent)]"
                      checked={picked.has(c.index)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p)
                          if (e.target.checked) n.add(c.index)
                          else n.delete(c.index)
                          return n
                        })
                      }
                    />
                    <span className="flex-1 truncate">{c.title}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {Math.max(1, Math.round(c.chars / 1000))}k
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div
            className="rounded-lg border border-border bg-sunken px-4 py-3 text-sm"
            role="status"
            aria-live="polite"
          >
            {!request ? (
              <span className="text-muted">
                Choose a book{scope === 'chapters' ? ' and chapters' : ''} to see the cost.
              </span>
            ) : estimating && !estimate ? (
              <span className="flex items-center gap-2 text-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Estimating…
              </span>
            ) : estimate ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">About {formatUsd(estimate.costUsd)}</span>
                  <span className="text-xs text-muted">
                    {estimate.parts} {estimate.parts === 1 ? 'part' : 'parts'}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {formatTokens(estimate.inputTokens)} tokens in · ~
                  {formatTokens(estimate.outputTokensEstimate)} out · {estimate.model}
                </div>
              </>
            ) : null}
          </div>

          <Button
            variant="primary"
            disabled={!request || starting || !key?.isSet}
            onClick={() => void start()}
          >
            {starting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={16} aria-hidden />
            )}{' '}
            Start
          </Button>
          <p className="text-xs leading-relaxed text-muted">
            The result is saved as a new version next to the original, which is never changed. You
            can pause and resume; finished parts are kept even if the app closes.
          </p>
        </div>

        {/* ---- jobs ---- */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {jobs.length === 0 ? (
            <EmptyState icon={Sparkles} title="No AI jobs yet">
              Choose a book and an action on the left. You’ll see each chapter’s result appear here
              as Claude writes it.
            </EmptyState>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="AI jobs">
                {jobs.slice(0, 12).map((j) => (
                  <button
                    key={j.id}
                    role="tab"
                    aria-selected={active?.id === j.id}
                    onClick={() => setOpenJob(j.id)}
                    className={cn(
                      'flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-left',
                      active?.id === j.id
                        ? 'border-accent bg-accent-soft'
                        : 'border-border bg-surface hover:bg-sunken'
                    )}
                  >
                    <span className="max-w-56 truncate text-sm">{j.title}</span>
                    <span className="flex items-center gap-2">
                      <span className="max-w-40 truncate text-xs text-muted">{j.bookTitle}</span>
                      <JobStatusBadge job={j} />
                    </span>
                  </button>
                ))}
              </div>
              {active && <JobView key={active.id} job={active} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
