import { readFile } from 'node:fs/promises'
import type { ExtractOptions, ExtractResult, ExtractedChapter } from '../types'
import type { Block } from '../html'
import { cleanText, decodeText, toParagraphs } from '../textUtils'
import { blocksToChapters } from './sections'

/** Lines that look like chapter headings in plain-text books (Project Gutenberg style). */
const CHAPTER_LINE =
  /^\s*((chapter|book|part|section|letter|canto|act|stave)\s+([0-9]+|[ivxlcdm]+|[a-z]+)\b.{0,80}|[ivxlcdm]{1,7}\.?|[0-9]{1,3}\.)\s*$/i

/** Project Gutenberg headers/footers aren't part of the book. */
export function stripGutenberg(text: string): string {
  const start = text.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i)
  const end = text.match(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i)
  if (!start) return text
  const from = (start.index ?? 0) + start[0].length
  const to = end?.index ?? text.length
  return to > from ? text.slice(from, to) : text
}

function gutenbergMeta(text: string): {
  title: string | null
  author: string | null
  language: string | null
} {
  const head = text.slice(0, 5000)
  const get = (k: string): string | null => {
    const m = head.match(new RegExp(`^${k}:\\s*(.+)$`, 'im'))
    return m ? cleanText(m[1]) : null
  }
  return { title: get('Title'), author: get('Author'), language: get('Language') }
}

export function splitPlainText(text: string): ExtractedChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const chapters: ExtractedChapter[] = []
  let buf: string[] = []
  let title: string | null = null
  const flush = (): void => {
    const paragraphs = toParagraphs(buf.join('\n'))
    if (paragraphs.length) chapters.push({ title: title ?? 'Opening', location: '', paragraphs })
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // A heading line must stand alone: blank (or start) above it.
    const isHeading = CHAPTER_LINE.test(line) && (i === 0 || !lines[i - 1].trim())
    if (isHeading) {
      flush()
      title = cleanText(line)
      continue
    }
    buf.push(line)
  }
  flush()
  // Too few headings → probably false positives or no structure; treat as one text.
  if (chapters.length < 2) {
    const paragraphs = toParagraphs(text)
    return paragraphs.length ? [{ title: 'Full text', location: 'section:0', paragraphs }] : []
  }
  chapters.forEach((c, i) => (c.location = `section:${i}`))
  return chapters
}

export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let inFence = false
  const flush = (): void => {
    const t = cleanText(para.join(' '))
    if (t) blocks.push({ kind: 'p', text: t })
    para = []
  }
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      flush()
      continue
    }
    if (inFence) {
      if (raw.trim()) blocks.push({ kind: 'p', text: raw })
      continue
    }
    const h = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      flush()
      blocks.push({ kind: `h${h[1].length}` as Block['kind'], text: cleanText(h[2]) })
      continue
    }
    if (!raw.trim()) {
      flush()
      continue
    }
    // Strip common inline markdown so search and AI see clean text.
    para.push(
      raw
        .replace(/^\s*([-*+]|\d+\.)\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|\*|_|`)/g, '')
    )
  }
  flush()
  return blocks
}

export async function extractPlain(opts: ExtractOptions): Promise<ExtractResult> {
  const raw = decodeText(new Uint8Array(await readFile(opts.filePath)))
  opts.onProgress?.(0.5)
  if (opts.format === 'md') {
    const blocks = markdownToBlocks(raw)
    const firstH1 = blocks.find((b) => b.kind === 'h1')?.text ?? null
    return {
      meta: { title: firstH1 },
      pageCount: null,
      chapters: blocksToChapters(blocks),
      coverPath: null,
      needsOcr: false
    }
  }
  const meta = gutenbergMeta(raw)
  return {
    meta,
    pageCount: null,
    chapters: splitPlainText(stripGutenberg(raw)),
    coverPath: null,
    needsOcr: false
  }
}
