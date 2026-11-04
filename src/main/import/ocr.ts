import { readFile } from 'node:fs/promises'
import { createWorker } from 'tesseract.js'
import type { ExtractResult } from './types'
import { throwIfAborted } from './types'
import { groupPages, openPdf, renderPageJpeg } from './extract/pdf'
import { toParagraphs } from './textUtils'

export interface OcrOptions {
  filePath: string
  /** Tesseract language code(s), e.g. 'eng' or 'ara+eng' */
  language: string
  /** Where downloaded language data is cached between runs. */
  cachePath: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Renders each PDF page and runs Tesseract on it. Language data is downloaded once, then cached. */
export async function ocrPdf(opts: OcrOptions): Promise<ExtractResult> {
  const { pdf, close } = await openPdf(new Uint8Array(await readFile(opts.filePath)))
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    worker = await createWorker(opts.language, 1, { cachePath: opts.cachePath })
    const pages: Array<{ page: number; paragraphs: string[] }> = []
    for (let i = 1; i <= pdf.numPages; i++) {
      throwIfAborted(opts.signal)
      const page = await pdf.getPage(i)
      // ~2000px wide is a good balance between OCR accuracy and speed for book pages.
      const image = await renderPageJpeg(page, 2000, 0.92)
      page.cleanup()
      const { data } = await worker.recognize(image)
      pages.push({ page: i, paragraphs: toParagraphs(data.text) })
      opts.onProgress?.(i / pdf.numPages)
    }
    return {
      meta: {},
      pageCount: pdf.numPages,
      chapters: groupPages(pages, []),
      coverPath: null,
      needsOcr: false
    }
  } finally {
    await worker?.terminate()
    await close()
  }
}
