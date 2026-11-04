import { Loader2 } from 'lucide-react'
import { activeJobs, useJobs } from '../stores/jobs'

/** Small sidebar card showing background work (imports, downloads, AI jobs). Hidden when idle. */
export function JobsIndicator(): React.JSX.Element | null {
  const jobs = activeJobs(useJobs((s) => s.jobs))
  if (jobs.length === 0) return null
  const first = jobs[0]
  return (
    <div
      className="rounded-lg border border-border bg-sunken px-3 py-2 text-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-text">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        <span className="truncate">{first.label}</span>
      </div>
      {first.progress !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-border">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.round(first.progress * 100)}%` }}
          />
        </div>
      )}
      {jobs.length > 1 && <div className="mt-1 text-muted">+{jobs.length - 1} more</div>}
    </div>
  )
}
