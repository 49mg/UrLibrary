/**
 * Utility process entry: runs one CPU-heavy extraction or OCR task, then exits.
 * Keeping this out of the main process keeps the UI responsive, and cancelling a job is just
 * killing this process.
 */
// pdf.js treats any Electron process whose process.type isn't 'browser' as a web page and then
// needs DOM APIs (web workers, document, fetch for fonts). This utility process is plain Node with
// no DOM, so present it as Node before pdf.js is (lazily) loaded.
Object.defineProperty(process, 'type', { value: undefined, configurable: true, writable: true })

import { extractBook } from '../import/extract'
import { ocrPdf } from '../import/ocr'
import type { WorkerMessage, WorkerTask } from './protocol'

const port = process.parentPort

function send(msg: WorkerMessage): void {
  port.postMessage(msg)
}

port.once('message', async (e: { data: WorkerTask }) => {
  const task = e.data
  let last = 0
  const onProgress = (fraction: number): void => {
    // Throttle to ~1% steps so we don't flood IPC on large books.
    if (fraction - last >= 0.01 || fraction >= 1) {
      last = fraction
      send({ type: 'progress', fraction })
    }
  }
  try {
    const result =
      task.type === 'extract'
        ? await extractBook({
            filePath: task.filePath,
            format: task.format,
            bookDir: task.bookDir,
            onProgress
          })
        : await ocrPdf({
            filePath: task.filePath,
            language: task.language,
            cachePath: task.cachePath,
            onProgress
          })
    send({ type: 'result', result })
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    setTimeout(() => process.exit(0), 50)
  }
})
