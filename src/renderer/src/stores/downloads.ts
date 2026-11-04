import { create } from 'zustand'
import type { CatalogFormat, ProviderId } from '../../../shared/ipc'

export interface DownloadRequest {
  provider: ProviderId
  id: string
  format: CatalogFormat['format']
  title: string
}

interface DownloadsState {
  /** jobId → what was requested, so failed downloads can be retried and finished ones opened. */
  requests: Record<string, DownloadRequest>
  remember: (jobId: string, req: DownloadRequest) => void
  forget: (jobId: string) => void
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  requests: {},
  remember: (jobId, req) => set({ requests: { ...get().requests, [jobId]: req } }),
  forget: (jobId) => {
    const next = { ...get().requests }
    delete next[jobId]
    set({ requests: next })
  }
}))
