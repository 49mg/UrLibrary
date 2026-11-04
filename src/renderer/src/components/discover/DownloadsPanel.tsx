import { useNavigate } from 'react-router'
import { AlertTriangle, BookOpen, CheckCircle2, Loader2, RotateCw, X } from 'lucide-react'
import { useJobs } from '../../stores/jobs'
import { useDownloads } from '../../stores/downloads'
import { useLibrary } from '../../stores/library'
import { startDownload } from '../../lib/discover'
import { toast } from '../../stores/toasts'

/** Downloads started from Discover: progress, cancel, retry, and open when done. */
export function DownloadsPanel(): React.JSX.Element | null {
  const navigate = useNavigate()
  const jobs = useJobs((s) => s.jobs)
  const { requests, forget } = useDownloads()
  const books = useLibrary((s) => s.books)
  const list = Object.values(jobs)
    .filter((j) => j.kind === 'download' && requests[j.id])
    .reverse()
  if (!list.length) return null

  return (
    <section aria-label="Downloads" className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Downloads</h2>
      <ul className="flex flex-col gap-2">
        {list.map((j) => {
          const req = requests[j.id]
          const book = books.find((b) => b.source === req.provider && b.sourceId === req.id)
          const active = j.status === 'queued' || j.status === 'running'
          return (
            <li key={j.id} className="flex items-center gap-3 text-sm">
              {active ? (
                <Loader2 size={16} className="shrink-0 animate-spin text-muted" aria-hidden />
              ) : j.status === 'done' ? (
                <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />
              ) : (
                <AlertTriangle size={16} className="shrink-0 text-danger" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{req.title}</div>
                {active && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-border">
                    <div
                      className={
                        j.progress === null
                          ? 'h-full w-1/3 animate-pulse bg-accent'
                          : 'h-full bg-accent transition-all'
                      }
                      style={
                        j.progress === null
                          ? undefined
                          : { width: `${Math.round(j.progress * 100)}%` }
                      }
                    />
                  </div>
                )}
                {j.status === 'error' && (
                  <div className="truncate text-xs text-danger">{j.error}</div>
                )}
                {j.status === 'cancelled' && <div className="text-xs text-muted">Cancelled</div>}
              </div>
              {active && (
                <button
                  aria-label={`Cancel download of ${req.title}`}
                  onClick={() =>
                    window.api.jobs.cancel(j.id).catch((e: Error) => toast.error(e.message))
                  }
                  className="rounded p-1 text-muted hover:text-text"
                >
                  <X size={16} />
                </button>
              )}
              {(j.status === 'error' || j.status === 'cancelled') && (
                <button
                  aria-label={`Retry download of ${req.title}`}
                  onClick={async () => {
                    forget(j.id)
                    await startDownload(
                      { provider: req.provider, id: req.id, title: req.title },
                      req.format
                    )
                  }}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-sunken hover:text-text"
                >
                  <RotateCw size={14} aria-hidden /> Retry
                </button>
              )}
              {j.status === 'done' && book && (
                <button
                  onClick={() => navigate(`/reader/${book.id}`)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent-soft"
                >
                  <BookOpen size={14} aria-hidden /> Open
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
