import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  Pause,
  Play,
  Square,
  Trash2,
  AlertTriangle
} from 'lucide-react'
import type { AiJob, AiPartDetail } from '../../../../shared/ipc'
import { Markdown } from '../Markdown'
import { Button } from '../ui'
import { Menu } from '../Menu'
import { useMenu } from '../../lib/useMenu'
import { useAi, costOf, formatTokens, formatUsd } from '../../stores/ai'
import { toast } from '../../stores/toasts'
import { cn } from '../../lib/cn'

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const STATUS_LABEL: Record<AiJob['status'], string> = {
  queued: 'Waiting',
  running: 'Working',
  paused: 'Paused',
  done: 'Done',
  error: 'Stopped',
  cancelled: 'Cancelled'
}

export function JobStatusBadge({ job }: { job: AiJob }): React.JSX.Element {
  const tone =
    job.status === 'done'
      ? 'text-success'
      : job.status === 'error'
        ? 'text-danger'
        : job.status === 'running'
          ? 'text-accent'
          : 'text-muted'
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone)}>
      {job.status === 'running' && <Loader2 size={12} className="animate-spin" aria-hidden />}
      {STATUS_LABEL[job.status]}
    </span>
  )
}

export function ExportMenu({ versionId }: { versionId: string }): React.JSX.Element {
  const { menu, openBelow, close } = useMenu()
  const run = (format: 'pdf' | 'docx' | 'md'): void => {
    window.api.versions
      .export(versionId, format)
      .then((r) => r && toast.success(`Exported to ${r.path}`))
      .catch((e) => toast.error(err(e)))
  }
  return (
    <>
      <Button onClick={openBelow} aria-haspopup="menu">
        <Download size={15} aria-hidden /> Export
      </Button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Export as"
          onClose={close}
          entries={[
            { kind: 'item', label: 'PDF…', onSelect: () => run('pdf') },
            { kind: 'item', label: 'Word (.docx)…', onSelect: () => run('docx') },
            { kind: 'item', label: 'Markdown…', onSelect: () => run('md') }
          ]}
        />
      )}
    </>
  )
}

/** One job: controls, part list, and the original vs. generated text of the selected part. */
export function JobView({ job }: { job: AiJob }): React.JSX.Element {
  const live = useAi((s) => s.live[job.id])
  const running = job.parts.find((p) => p.status === 'running')
  const [picked, setPicked] = useState<number | null>(null)
  const selected =
    picked ?? running?.idx ?? job.parts.findLast((p) => p.status === 'done')?.idx ?? 0
  const [detail, setDetail] = useState<AiPartDetail | null>(null)
  const part = job.parts[selected]

  // Load the part's saved text (refetch when it finishes).
  useEffect(() => {
    let cancelled = false
    window.api.ai
      .part(job.id, selected)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [job.id, selected, part?.status])

  const done = job.parts.filter((p) => p.status === 'done').length
  const streaming = live && live.idx === selected ? live.text : null
  const output = streaming ?? (detail?.idx === selected ? detail.output : '')
  const act = (p: Promise<unknown>): void => void p.catch((e) => toast.error(err(e)))

  return (
    <section
      aria-label={`AI job: ${job.title}`}
      className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">
            {job.title} <span className="font-normal text-muted">· {job.bookTitle}</span>
          </h2>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
            <JobStatusBadge job={job} />
            <span>
              {done} of {job.parts.length} parts
            </span>
            <span title={`${job.inputTokens} input · ${job.outputTokens} output tokens`}>
              {formatTokens(job.inputTokens + job.outputTokens)} tokens ·{' '}
              {formatUsd(costOf(job.inputTokens, job.outputTokens))}
            </span>
          </div>
          {job.error && (
            <p className="mt-1 flex items-center gap-1 text-xs text-danger">
              <AlertTriangle size={12} aria-hidden /> {job.error}
            </p>
          )}
        </div>
        {(job.status === 'running' || job.status === 'queued') && (
          <>
            <Button onClick={() => act(window.api.ai.pause(job.id))}>
              <Pause size={15} aria-hidden /> Pause
            </Button>
            <Button variant="ghost" onClick={() => act(window.api.ai.cancel(job.id))}>
              <Square size={14} aria-hidden /> Cancel
            </Button>
          </>
        )}
        {(job.status === 'paused' || job.status === 'error' || job.status === 'cancelled') && (
          <Button variant="primary" onClick={() => act(window.api.ai.resume(job.id))}>
            <Play size={15} aria-hidden /> {job.status === 'paused' ? 'Resume' : 'Continue'}
          </Button>
        )}
        {job.versionId && (
          <>
            <Link to={`/reader/${job.bookId}?version=${job.versionId}`}>
              <Button variant="primary">
                <BookOpen size={15} aria-hidden /> Read
              </Button>
            </Link>
            <ExportMenu versionId={job.versionId} />
          </>
        )}
        {job.status !== 'running' && (
          <button
            aria-label="Delete job"
            title="Delete job (the saved version is kept)"
            onClick={() => {
              act(window.api.ai.deleteJob(job.id))
              useAi.getState().remove(job.id)
            }}
            className="rounded p-2 text-muted hover:text-danger"
          >
            <Trash2 size={16} />
          </button>
        )}
      </header>
      <div className="h-1 bg-sunken">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${(done / Math.max(1, job.parts.length)) * 100}%` }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <ol aria-label="Parts" className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
          {job.parts.map((p) => (
            <li key={p.idx}>
              <button
                onClick={() => setPicked(p.idx)}
                aria-current={p.idx === selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                  p.idx === selected ? 'bg-accent-soft' : 'hover:bg-sunken'
                )}
              >
                {p.status === 'done' ? (
                  <CheckCircle2 size={14} className="shrink-0 text-success" aria-label="Done" />
                ) : p.status === 'running' ? (
                  <Loader2
                    size={14}
                    className="shrink-0 animate-spin text-accent"
                    aria-label="Working"
                  />
                ) : (
                  <Circle size={14} className="shrink-0 text-muted" aria-label="Waiting" />
                )}
                <span className="truncate">{p.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div
            className="min-h-0 overflow-y-auto border-r border-border p-5"
            aria-label="Original text"
          >
            <h3 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
              Original
            </h3>
            <div className="font-serif text-[15px] leading-relaxed whitespace-pre-wrap">
              {detail?.idx === selected ? detail.source : ''}
            </div>
          </div>
          <div
            className="min-h-0 overflow-y-auto p-5"
            aria-label="Generated text"
            aria-live="polite"
          >
            <h3 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
              Result{' '}
              {streaming !== null && (
                <Loader2 size={12} className="ml-1 inline animate-spin" aria-hidden />
              )}
            </h3>
            {output ? (
              <Markdown text={output} className="font-serif text-[15px] leading-relaxed" />
            ) : (
              <p className="text-sm text-muted">
                {part?.status === 'pending'
                  ? 'Not generated yet.'
                  : part?.status === 'running'
                    ? 'Thinking…'
                    : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
