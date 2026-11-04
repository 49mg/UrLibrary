/**
 * Text-quote anchoring (after the W3C Web Annotation TextQuoteSelector): a highlight remembers the
 * exact text plus a little context on each side and its character position. If the document text
 * shifts (re-render, edited file), we find the quote again using that context.
 */

export interface TextQuote {
  exact: string
  prefix: string
  suffix: string
  /** Character offsets when the highlight was made; a hint, not the truth. */
  start: number
  end: number
}

const CONTEXT = 32

export function quoteSelector(text: string, start: number, end: number): TextQuote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    start,
    end
  }
}

/** Number of matching characters going backwards from the ends of both strings. */
function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Finds where a quote is in `text` now. Returns null if the exact text no longer occurs (orphaned).
 * Among several occurrences, prefers the one whose surrounding context matches best, then the one
 * closest to the original position.
 */
export function resolveQuote(text: string, q: TextQuote): { start: number; end: number } | null {
  if (!q.exact) return null
  // No shortcut on "same text at the old position": with repeated phrases that can be the wrong
  // occurrence. Context decides; the old position only breaks ties.
  let best: { start: number; score: number } | null = null
  for (let at = text.indexOf(q.exact); at >= 0; at = text.indexOf(q.exact, at + 1)) {
    const before = text.slice(Math.max(0, at - CONTEXT), at)
    const after = text.slice(at + q.exact.length, at + q.exact.length + CONTEXT)
    const context = commonSuffix(before, q.prefix) + commonPrefix(after, q.suffix)
    // Context dominates; distance only breaks ties (normalized to < 1).
    const score = context - Math.abs(at - q.start) / (text.length + 1)
    if (!best || score > best.score) best = { start: at, score }
  }
  return best ? { start: best.start, end: best.start + q.exact.length } : null
}
