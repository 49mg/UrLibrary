export type FracRect = [number, number, number, number] // x, y, w, h as fractions of the page

/**
 * Text selections produce one rect per text span, often overlapping or split mid-line.
 * Merge rects on the same line that touch or overlap into one, so highlights look like
 * clean bars and export as tidy PDF quads.
 */
export function mergeLineRects(rects: FracRect[]): FracRect[] {
  const sorted = [...rects]
    .filter(([, , w, h]) => w > 0 && h > 0)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const out: FracRect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last) {
      const [lx, ly, lw, lh] = last
      const sameLine = Math.abs(ly + lh / 2 - (r[1] + r[3] / 2)) < Math.min(lh, r[3]) * 0.5
      const touches = r[0] <= lx + lw + Math.max(lh, r[3]) * 0.6 // small gaps between words
      if (sameLine && touches) {
        const x = Math.min(lx, r[0])
        const y = Math.min(ly, r[1])
        const right = Math.max(lx + lw, r[0] + r[2])
        const bottom = Math.max(ly + lh, r[1] + r[3])
        out[out.length - 1] = [x, y, right - x, bottom - y]
        continue
      }
    }
    out.push([...r])
  }
  return out
}

/** Converts a client rect to page fractions, or null if it lies outside the page. */
export function toPageFraction(r: DOMRectReadOnly, page: DOMRectReadOnly): FracRect | null {
  const left = Math.max(r.left, page.left)
  const top = Math.max(r.top, page.top)
  const right = Math.min(r.right, page.right)
  const bottom = Math.min(r.bottom, page.bottom)
  if (right - left < 1 || bottom - top < 1) return null
  return [
    (left - page.left) / page.width,
    (top - page.top) / page.height,
    (right - left) / page.width,
    (bottom - top) / page.height
  ]
}

export function contains([x, y, w, h]: FracRect, px: number, py: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h
}
