import { create } from 'zustand'
import type { AiJob } from '../../../shared/ipc'

interface AiState {
  jobs: Record<string, AiJob>
  /** Text streamed so far for the part currently being generated, per job. */
  live: Record<string, { idx: number; text: string }>
  /** Streamed answers to quick questions, per request id. */
  answers: Record<string, string>
  upsert: (job: AiJob) => void
  remove: (id: string) => void
}

export const useAi = create<AiState>((set, get) => ({
  jobs: {},
  live: {},
  answers: {},
  upsert: (job) => {
    const live = { ...get().live }
    // Drop the live buffer once that part is saved (the saved text is fetched instead).
    const cur = live[job.id]
    if (cur && job.parts[cur.idx]?.status !== 'running') delete live[job.id]
    set({ jobs: { ...get().jobs, [job.id]: job }, live })
  },
  remove: (id) => {
    const jobs = { ...get().jobs }
    delete jobs[id]
    set({ jobs })
  }
}))

/** Call once at startup: mirrors AI job updates and streamed text from main. */
export function subscribeAi(): () => void {
  window.api.ai
    .jobs()
    .then((jobs) => jobs.forEach((j) => useAi.getState().upsert(j)))
    .catch(() => undefined)
  const offJob = window.api.on('ai:job', (job) => useAi.getState().upsert(job))
  const offDelta = window.api.on('ai:delta', (d) => {
    const s = useAi.getState()
    if (d.jobId !== undefined && d.idx !== undefined) {
      const cur = s.live[d.jobId]
      const text = cur && cur.idx === d.idx ? cur.text + d.text : d.text
      useAi.setState({ live: { ...s.live, [d.jobId]: { idx: d.idx, text } } })
    } else if (d.requestId) {
      useAi.setState({
        answers: { ...s.answers, [d.requestId]: (s.answers[d.requestId] ?? '') + d.text }
      })
    }
  })
  return () => {
    offJob()
    offDelta()
  }
}

/** USD for a token count at Opus 5.5 prices. */
export function costOf(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 4 + outputTokens * 20) / 1e6
}

export function formatUsd(n: number): string {
  if (n < 0.01) return n === 0 ? '$0' : '< $0.01'
  return `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`
}

export function formatTokens(n: number): string {
  return n < 1000
    ? String(n)
    : n < 1e6
      ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
      : `${(n / 1e6).toFixed(2)}M`
}
