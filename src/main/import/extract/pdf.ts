import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { ExtractOptions, ExtractResult, ExtractedChapter } from '../types'
import { throwIfAborted } from '../types'
import { cleanText, plausibleTitle } from '../textUtils'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>

// __filename exists both in the CommonJS main bundle and under Vitest.
const require_ = createRequire(__filename)

let pdfjsPromise: Promise<PdfJs> | null = null
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

/** pdf.js needs its bundled font data to read PDFs that use the 14 standard fonts. */
function standardFontDataUrl(): string {
  return join(dirname(require_.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/'
}

/** Opens a PDF; call `close()` when done to free the document and its worker. */
export async function openPdf(
  data: Uint8Array
): Promise<{ pdf: PdfDoc; close: () => Promise<void> }> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ data, standardFontDataUrl: standardFontDataUrl(), verbosity: 0 })
  const pdf = await task.promise
  return { pdf, close: () => task.destroy() }
}

interface TextItem {
  str: string
  hasEOL?: boolean
  transform?: number[]
  height?: number
}

/** Rebuilds paragraphs from positioned text items: line breaks via hasEOL, paragraphs via larger vertical gaps. */
export function itemsToParagraphs(items: TextItem[]): string[] {
  const lines: Array<{ text: string; y: number | null; h: number }> = []
  let cur = ''
  let y: number | null = null
  let h = 0
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    if (y === null && it.transform) y = it.transform[5]
    if (it.height) h = Math.max(h, it.height)
    cur += it.str
    if (it.hasEOL) {
      lines.push({ text: cur, y, h })
      cur = ''
      y = null
      h = 0
    }
  }
  if (cur.trim()) lines.push({ text: cur, y, h })

  const paragraphs: string[] = []
  let para = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text.trim()
    const prev = lines[i - 1]
    const gap = prev && prev.y !== null && lines[i].y !== null ? prev.y - (lines[i].y as number) : 0
    const lineH = lines[i].h || prev?.h || 12
    const newPara = !line || (prev && gap > lineH * 1.6)
    if (newPara && para) {
      paragraphs.push(para)
      para = ''
    }
    if (!line) continue
    if (para.endsWith('-') && /^[\p{Ll}]/u.test(line)) para = para.slice(0, -1) + line
    else para = para ? `${para} ${line}` : line
  }
  if (para) paragraphs.push(para)
  return paragraphs.map(cleanText).filter(Boolean)
}

export async function pageParagraphs(page: PdfPage): Promise<string[]> {
  const tc = await page.getTextContent()
  return itemsToParagraphs(tc.items as TextItem[])
}

/** Top-level outline entries resolved to 1-based page numbers, in page order. */
async function outlineChapters(pdf: PdfDoc): Promise<Array<{ title: string; page: number }>> {
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline?.length) return []
  const out: Array<{ title: string; page: number }> = []
  for (const item of outline) {
    try {
      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      if (!Array.isArray(dest) || !dest[0]) continue
      const ref = dest[0]
      const index = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
      const title = cleanText(item.title ?? '')
      if (title) out.push({ title, page: index + 1 })
    } catch {
      // Broken outline entries are common; skip them.
    }
  }
  out.sort((a, b) => a.page - b.page)
  return out.filter((c, i) => i === 0 || c.page !== out[i - 1].page)
}

const SECTION_PAGES = 10

/** Groups pages into chapters using the outline, or fixed-size page ranges when there is none. */
export function groupPages(
  pages: Array<{ page: number; paragraphs: string[] }>,
  outline: Array<{ title: string; page: number }>
): ExtractedChapter[] {
  const make = (title: string, list: typeof pages): ExtractedChapter => ({
    title,
    location: `page:${list[0].page}`,
    paragraphs: list.flatMap((p) => p.paragraphs),
    pages: list
  })
  if (pages.length === 0) return []
  if (outline.length > 0) {
    const chapters: ExtractedChapter[] = []
    const first = outline[0].page
    if (first > 1)
      chapters.push(
        make(
          'Front matter',
          pages.filter((p) => p.page < first)
        )
      )
    outline.forEach((o, i) => {
      const end = outline[i + 1]?.page ?? Infinity
      const list = pages.filter((p) => p.page >= o.page && p.page < end)
      if (list.length) chapters.push(make(o.title, list))
    })
    return chapters.filter((c) => c.pages && c.pages.length > 0)
  }
  const chapters: ExtractedChapter[] = []
  for (let i = 0; i < pages.length; i += SECTION_PAGES) {
    const list = pages.slice(i, i + SECTION_PAGES)
    const a = list[0].page
    const b = list[list.length - 1].page
    chapters.push(make(a === b ? `Page ${a}` : `Pages ${a}–${b}`, list))
  }
  return chapters
}

export async function renderPageJpeg(
  page: PdfPage,
  width: number,
  quality = 0.85
): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
  return canvas.toBuffer('image/jpeg', Math.round(quality * 100))
}

function infoString(s: unknown): string | null {
  return typeof s === 'string' && s.trim() ? cleanText(s) : null
}

export async function extractPdf(opts: ExtractOptions): Promise<ExtractResult> {
  const { pdf, close } = await openPdf(new Uint8Array(await readFile(opts.filePath)))
  try {
    const { info } = (await pdf.getMetadata().catch(() => ({ info: {} }))) as {
      info: Record<string, unknown>
    }
    const pages: Array<{ page: number; paragraphs: string[] }> = []
    let chars = 0
    for (let i = 1; i <= pdf.numPages; i++) {
      throwIfAborted(opts.signal)
      const page = await pdf.getPage(i)
      const paragraphs = await pageParagraphs(page)
      chars += paragraphs.reduce((n, p) => n + p.length, 0)
      pages.push({ page: i, paragraphs })
      page.cleanup()
      opts.onProgress?.(i / pdf.numPages)
    }

    let coverPath: string | null = null
    try {
      const jpeg = await renderPageJpeg(await pdf.getPage(1), 400)
      await writeFile(join(opts.bookDir, 'cover.jpg'), jpeg)
      coverPath = 'cover.jpg'
    } catch (err) {
      console.warn('[pdf] cover render failed', err)
    }

    // Under ~25 characters per page on average means there's essentially no text layer.
    const needsOcr = pdf.numPages > 0 && chars / pdf.numPages < 25
    return {
      meta: {
        title: plausibleTitle(infoString(info.Title)),
        author: infoString(info.Author),
        language: infoString(info.Language),
        description: infoString(info.Subject)
      },
      pageCount: pdf.numPages,
      chapters: groupPages(pages, await outlineChapters(pdf)),
      coverPath,
      needsOcr
    }
  } finally {
    await close()
  }
}
