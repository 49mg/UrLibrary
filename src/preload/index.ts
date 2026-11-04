import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  type EventChannel,
  type InvokeArgs,
  type InvokeChannel,
  type InvokeResult,
  type IpcEnvelope,
  type IpcEventMap
} from '../shared/ipc'

async function invoke<K extends InvokeChannel>(
  channel: K,
  args?: InvokeArgs<K>
): Promise<InvokeResult<K>> {
  const res = (await ipcRenderer.invoke(channel, args)) as IpcEnvelope<InvokeResult<K>>
  if (res.ok) return res.data
  // Errors crossing contextBridge keep only their message, so the UI shows `message` as-is.
  const err = new Error(res.error.message)
  err.name = res.error.code
  throw err
}

function on<E extends EventChannel>(event: E, cb: (payload: IpcEventMap[E]) => void): () => void {
  if (!EVENT_CHANNELS.includes(event)) throw new Error(`Unknown event: ${event}`)
  const listener = (_e: IpcRendererEvent, payload: IpcEventMap[E]): void => cb(payload)
  ipcRenderer.on(event, listener)
  return () => ipcRenderer.removeListener(event, listener)
}

const api = {
  app: {
    info: () => invoke('app:info')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch: InvokeArgs<'settings:update'>) => invoke('settings:update', patch)
  },
  apiKey: {
    status: () => invoke('apiKey:status'),
    set: (key: string) => invoke('apiKey:set', { key }),
    clear: () => invoke('apiKey:clear'),
    test: () => invoke('apiKey:test')
  },
  books: {
    list: () => invoke('books:list')
  },
  library: {
    openFolder: () => invoke('library:openFolder')
  },
  on
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
