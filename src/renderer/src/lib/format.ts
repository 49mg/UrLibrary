import type { BookFormat } from '../../../shared/ipc'

export const FORMAT_LABEL: Record<BookFormat, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  docx: 'Word',
  txt: 'Text',
  md: 'Markdown'
}

/** Human label for a stored location, e.g. `page:12` → "Page 12". Empty for non-page locations. */
export function locationLabel(location: string): string {
  const i = location.indexOf(':')
  if (i < 0) return ''
  return location.slice(0, i) === 'page' ? `Page ${location.slice(i + 1)}` : ''
}
