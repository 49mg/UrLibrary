import { create } from 'zustand'
import type { Job } from '../../../shared/ipc'

interface JobsState {
  jobs: Record<string, Job>
  upsert: (job: Job) => void
  clearFinished: () => void
}

const FINISHED = new Set(['done', 'error', 'cancelled'])

export const useJobs = create<JobsState>((set, get) => ({
  jobs: {},
  upsert: (job) => set({ jobs: { ...get().jobs, [job.id]: job } }),
  clearFinished: () =>
    set({
      jobs: Object.fromEntries(
        Object.entries(get().jobs).filter(([, j]) => !FINISHED.has(j.status))
      )
    })
}))

export function activeJobs(jobs: Record<string, Job>): Job[] {
  return Object.values(jobs).filter((j) => !FINISHED.has(j.status))
}

/** Call once at startup: mirrors job events from main into the store. */
export function subscribeJobs(): () => void {
  return window.api.on('jobs:update', (job) => useJobs.getState().upsert(job))
}
