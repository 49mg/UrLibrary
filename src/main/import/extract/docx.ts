import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import mammoth from 'mammoth'
import type { ExtractOptions, ExtractResult } from '../types'
import { htmlToBlocks, type Block } from '../html'
import { cleanText, plausibleTitle } from '../textUtils'
import { blocksToChapters } from './sections'

function coreProps(data: Uint8Array): {
  title: string | null
  author: string | null
  language: string | null
  description: string | null
} {
  try {
    const files = unzipSync(data, { filter: (f) => f.name === 'docProps/core.xml' })
    const core = files['docProps/core.xml']
    if (!core) return { title: null, author: null, language: null, description: null }
    const doc = new XMLParser({ removeNSPrefix: true }).parse(strFromU8(core)) as {
      coreProperties?: Record<string, unknown>
    }
    const p = doc.coreProperties ?? {}
    const s = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? cleanText(v) : null
    return {
      title: plausibleTitle(s(p.title)),
      author: s(p.creator),
      language: s(p.language),
      description: s(p.description) ?? s(p.subject)
    }
  } catch {
    return { title: null, author: null, language: null, description: null }
  }
}

export async function extractDocx(opts: ExtractOptions): Promise<ExtractResult> {
  const data = new Uint8Array(await readFile(opts.filePath))
  const meta = coreProps(data)
  // Images are dropped: we only need text here; the reader renders the original file itself.
  const { value: html } = await mammoth.convertToHtml(
    { buffer: Buffer.from(data) },
    { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) }
  )
  opts.onProgress?.(0.7)
  const blocks: Block[] = htmlToBlocks(html)
  const chapters = blocksToChapters(blocks)
  opts.onProgress?.(1)
  return { meta, pageCount: null, chapters, coverPath: null, needsOcr: false }
}
