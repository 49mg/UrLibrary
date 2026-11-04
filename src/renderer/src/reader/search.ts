import { SNIPPET_END, SNIPPET_START } from '../../../shared/ipc'

/** Lowercases and strips diacritics so "cafe" finds "Café". Keeps string length stable per char. */
export function fold(s: string): string {
  return s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Finds `query` in `text` (case- and accent-insensitive) and returns match offsets.
 * Folding can change length (e.g. "é" → "e" + mark removed), so we map offsets back per character.
 */
export function findAll(
  text: string,
  query: string,
  limit = 500
): Array<{ start: number; end: number }> {
  const q = fold(query.trim())
  if (!q) return []
  // Build the folded text plus a map from folded index → original index.
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i])
    for (let k = 0; k < f.length; k++) map.push(i)
    folded += f
  }
  map.push(text.length)
  const out: Array<{ start: number; end: number }> = []
  let from = 0
  while (out.length < limit) {
    const at = folded.indexOf(q, from)
    if (at < 0) break
    let end = map[at + q.length - 1] + 1
    // Include combining marks that follow the last matched letter (decomposed "é" = "e" + U+0301).
    while (end < text.length && /\p{M}/u.test(text[end])) end++
    out.push({ start: map[at], end })
    from = at + q.length
  }
  return out
}

/** "…words around [match] and more…" with the match wrapped in snippet markers. */
export function excerpt(text: string, start: number, end: number, radius = 70): string {
  const a = Math.max(0, start - radius)
  const b = Math.min(text.length, end + radius)
  const pre = text.slice(a, start).replace(/\s+/g, ' ')
  const post = text.slice(end, b).replace(/\s+/g, ' ')
  return `${a > 0 ? '…' : ''}${pre}${SNIPPET_START}${text.slice(start, end)}${SNIPPET_END}${post}${b < text.length ? '…' : ''}`
}

/** Wraps text[start..end) in snippet markers, keeping the full text. */
export function markRange(text: string, start: number, end: number): string {
  return `${text.slice(0, start)}${SNIPPET_START}${text.slice(start, end)}${SNIPPET_END}${text.slice(end)}`
}
