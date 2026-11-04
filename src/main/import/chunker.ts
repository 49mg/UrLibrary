import type { ExtractedChapter } from './types'
import type { ChunkRow } from '../db/booksRepo'

/** Target size of one search/AI chunk. Big enough for context, small enough for precise hits. */
export const CHUNK_CHARS = 2000

function packParagraphs(paragraphs: string[], max = CHUNK_CHARS): string[] {
  const out: string[] = []
  let cur = ''
  const flush = (): void => {
    if (cur) out.push(cur)
    cur = ''
  }
  for (const p of paragraphs) {
    if (p.length > max) {
      // A single huge paragraph (common in bad PDFs): split on sentence ends, then hard-wrap.
      flush()
      const sentences = p.match(/[^.!?。؟]+[.!?。؟]*\s*/g) ?? [p]
      for (const s of sentences) {
        if (cur.length + s.length > max) flush()
        if (s.length > max) {
          for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim())
        } else cur += s
      }
      flush()
      continue
    }
    if (cur && cur.length + p.length + 2 > max) flush()
    cur = cur ? `${cur}\n\n${p}` : p
  }
  flush()
  return out.filter((c) => c.trim().length > 0)
}

/**
 * Splits chapters into chunks at paragraph boundaries. PDF chapters are chunked per page so a hit
 * can jump to the exact page. Chunk ids are `<chapterIndex>-<n>`, stable for a given extraction.
 */
export function chunkChapters(chapters: ExtractedChapter[]): ChunkRow[] {
  const rows: ChunkRow[] = []
  chapters.forEach((ch, ci) => {
    let n = 0
    const units = ch.pages
      ? ch.pages.map((p) => ({ location: `page:${p.page}`, paragraphs: p.paragraphs }))
      : [{ location: ch.location, paragraphs: ch.paragraphs }]
    for (const u of units) {
      for (const content of packParagraphs(u.paragraphs)) {
        rows.push({ chunkId: `${ci}-${n++}`, chapter: ch.title, location: u.location, content })
      }
    }
  })
  return rows
}
