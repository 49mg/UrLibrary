import type { BookFormat } from '../../shared/ipc'
import type { ExtractResult } from '../import/types'

/** Messages between the main process and the extraction utility process. */
export type WorkerTask =
  | { type: 'extract'; filePath: string; format: BookFormat; bookDir: string }
  | { type: 'ocr'; filePath: string; language: string; cachePath: string }
  | { type: 'html'; filePath: string; format: BookFormat }

/** What each task type resolves to. */
export interface WorkerResults {
  extract: ExtractResult
  ocr: ExtractResult
  html: { html: string }
}

export type WorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'result'; result: WorkerResults[keyof WorkerResults] }
  | { type: 'error'; message: string }
