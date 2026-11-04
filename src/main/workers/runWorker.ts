import { utilityProcess } from 'electron'
import extractWorkerPath from './extractWorker?modulePath'
import type { WorkerMessage, WorkerResults, WorkerTask } from './protocol'

/** Runs a task in a fresh utility process. Aborting the signal kills the process. */
export function runInWorker<T extends WorkerTask>(
  task: T,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<WorkerResults[T['type']]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled'))
    const child = utilityProcess.fork(extractWorkerPath, [], {
      serviceName: `ur-library-${task.type}`,
      stdio: 'inherit'
    })
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => {
      child.kill()
      finish(() => reject(new Error('Cancelled')))
    }
    signal.addEventListener('abort', onAbort)
    child.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'progress') onProgress(msg.fraction)
      else if (msg.type === 'result') finish(() => resolve(msg.result as WorkerResults[T['type']]))
      else if (msg.type === 'error') finish(() => reject(new Error(msg.message)))
    })
    child.on('exit', (code) => {
      finish(() => reject(new Error(`Extraction process exited unexpectedly (code ${code})`)))
    })
    child.on('spawn', () => child.postMessage(task))
  })
}
