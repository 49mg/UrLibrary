import { randomUUID } from 'node:crypto'
import type { Job, JobKind } from '../../shared/ipc'

export interface JobContext {
  progress: (fraction: number | null) => void
  signal: AbortSignal
}

interface Entry {
  job: Job
  run: (ctx: JobContext) => Promise<void>
  controller: AbortController
}

/**
 * Runs background jobs with a concurrency limit and reports every state change.
 * Finished jobs are kept briefly so the UI can show their final state.
 */
export class JobQueue {
  private queue: Entry[] = []
  private running = new Map<string, Entry>()
  private finished: Job[] = []

  constructor(
    private onUpdate: (job: Job) => void,
    private concurrency = 1
  ) {}

  add(kind: JobKind, label: string, run: (ctx: JobContext) => Promise<void>, bookId?: string): Job {
    const job: Job = { id: randomUUID(), kind, label, status: 'queued', progress: null, bookId }
    this.queue.push({ job, run, controller: new AbortController() })
    this.emit(job)
    this.pump()
    return job
  }

  list(): Job[] {
    return [...this.running.values(), ...this.queue].map((e) => e.job).concat(this.finished)
  }

  cancel(id: string): void {
    const queued = this.queue.findIndex((e) => e.job.id === id)
    if (queued >= 0) {
      const [e] = this.queue.splice(queued, 1)
      this.finish(e, 'cancelled')
      return
    }
    this.running.get(id)?.controller.abort()
  }

  cancelForBook(bookId: string): void {
    for (const e of [...this.queue, ...this.running.values()]) {
      if (e.job.bookId === bookId) this.cancel(e.job.id)
    }
  }

  hasActiveJob(bookId: string): boolean {
    return [...this.queue, ...this.running.values()].some((e) => e.job.bookId === bookId)
  }

  /** Resolves when nothing is queued or running (used by tests). */
  async idle(): Promise<void> {
    while (this.queue.length || this.running.size) await new Promise((r) => setTimeout(r, 10))
  }

  private emit(job: Job): void {
    this.onUpdate({ ...job })
  }

  private finish(e: Entry, status: Job['status'], error?: string): void {
    e.job.status = status
    e.job.error = error
    if (status === 'done') e.job.progress = 1
    this.emit(e.job)
    this.finished = [e.job, ...this.finished].slice(0, 20)
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queue.length) {
      const e = this.queue.shift() as Entry
      this.running.set(e.job.id, e)
      e.job.status = 'running'
      this.emit(e.job)
      let lastSent = 0
      const ctx: JobContext = {
        signal: e.controller.signal,
        progress: (p) => {
          e.job.progress = p
          const now = Date.now()
          if (now - lastSent > 100 || p === 1) {
            lastSent = now
            this.emit(e.job)
          }
        }
      }
      e.run(ctx)
        .then(() => this.finish(e, e.controller.signal.aborted ? 'cancelled' : 'done'))
        .catch((err: unknown) =>
          this.finish(
            e,
            e.controller.signal.aborted ? 'cancelled' : 'error',
            err instanceof Error ? err.message : String(err)
          )
        )
        .finally(() => {
          this.running.delete(e.job.id)
          this.pump()
        })
    }
  }
}
