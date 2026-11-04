import type { Block } from '../html'
import type { ExtractedChapter } from '../types'

const LEVEL = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6, p: 99 } as const

/**
 * Splits a flat list of blocks into chapters at the top heading level that occurs more than once
 * (a single H1 is usually the document title, so chapters are then the H2s).
 * Text before the first chapter heading becomes an "Introduction" section when non-trivial.
 */
export function blocksToChapters(blocks: Block[], fallbackTitle = 'Full text'): ExtractedChapter[] {
  const counts = new Map<number, number>()
  for (const b of blocks)
    if (b.kind !== 'p') counts.set(LEVEL[b.kind], (counts.get(LEVEL[b.kind]) ?? 0) + 1)
  const levels = [...counts.keys()].sort((a, b) => a - b)
  const splitLevel = levels.find((l) => (counts.get(l) ?? 0) > 1) ?? levels[0]

  if (splitLevel === undefined) {
    const paragraphs = blocks.map((b) => b.text)
    return paragraphs.length ? [{ title: fallbackTitle, location: 'section:0', paragraphs }] : []
  }

  const chapters: ExtractedChapter[] = []
  let current: ExtractedChapter | null = null
  const preface: string[] = []
  for (const b of blocks) {
    // A lone higher-level heading before the first chapter is the document title, not a chapter.
    if (b.kind !== 'p' && LEVEL[b.kind] < splitLevel && !current) continue
    if (b.kind !== 'p' && LEVEL[b.kind] <= splitLevel) {
      current = { title: b.text.split('\n')[0], location: '', paragraphs: [] }
      chapters.push(current)
      continue
    }
    if (current) current.paragraphs.push(b.text)
    else preface.push(b.text)
  }
  if (preface.join(' ').length > 200)
    chapters.unshift({ title: 'Introduction', location: '', paragraphs: preface })
  else if (preface.length && chapters[0]) chapters[0].paragraphs.unshift(...preface)

  const kept = chapters.filter((c) => c.paragraphs.length > 0)
  kept.forEach((c, i) => (c.location = `section:${i}`))
  return kept
}
