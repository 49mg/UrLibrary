import type { PdfZoom } from '../../../shared/ipc'

const STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** Next zoom level up or down from the current one ('page-width' etc. resolve to their real scale). */
export function zoomStep(current: PdfZoom, dir: 1 | -1, actualScale: number): number {
  const base = typeof current === 'number' ? current : actualScale
  if (dir > 0) return STEPS.find((s) => s > base + 0.01) ?? 3
  return [...STEPS].reverse().find((s) => s < base - 0.01) ?? 0.5
}
