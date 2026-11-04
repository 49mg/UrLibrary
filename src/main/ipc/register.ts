import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '../../shared/ipc'
import { invokeSchemas } from './schemas'
import { createHandler } from './handler'

type Impl = {
  [K in InvokeChannel]: (args: InvokeArgs<K>) => InvokeResult<K> | Promise<InvokeResult<K>>
}

/** Only accept IPC from our own renderer (dev server or packaged file://), never from other frames. */
function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl))
}

export function registerIpc(impl: Impl): void {
  for (const channel of Object.keys(impl) as InvokeChannel[]) {
    const run = createHandler(invokeSchemas[channel] as never, impl[channel] as never)
    ipcMain.handle(channel, (e, raw) => {
      if (!isTrustedSender(e)) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender' } }
      }
      return run(raw)
    })
  }
}
