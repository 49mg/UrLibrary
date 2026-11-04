import type { BookFormat } from '../../shared/ipc'
import type { ExtractResult } from '../import/types'

/** Messages between the main process and the extraction utility process. */
export type WorkerTask =
  | { type: 'extract'; filePath: string; format: BookFormat; bookDir: string }
  | { type: 'ocr'; filePath: string; language: string; cachePath: string }

export type WorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'result'; result: ExtractResult }
  | { type: 'error'; message: string }
