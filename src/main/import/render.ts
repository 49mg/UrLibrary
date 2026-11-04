import { readFile } from 'node:fs/promises'
import mammoth from 'mammoth'
import type { BookFormat } from '../../shared/ipc'
import type { ExtractedChapter } from './types'
import { decodeText } from './textUtils'
import { splitPlainText, stripGutenberg } from './extract/plain'
import { renderMarkdown } from './markdown'

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )

/** Plain-text chapters as HTML sections with ids matching their `section:<n>` locations. */
export function renderPlainChapters(chapters: ExtractedChapter[]): string {
  return chapters
    .map((c, i) => {
      const heading = c.title === 'Full text' ? '' : `<h2>${escape(c.title)}</h2>`
      const body = c.paragraphs.map((p) => `<p>${escape(p)}</p>`).join('\n')
      return `<section id="sl-section-${i}">${heading}\n${body}</section>`
    })
    .join('\n')
}

export async function renderDocx(data: Buffer): Promise<string> {
  // Images become data: URIs so the document is self-contained.
  const { value } = await mammoth.convertToHtml({ buffer: data })
  return value
}

/** Renders a non-PDF/EPUB book to (unsanitized) HTML. The renderer sanitizes before display. */
export async function renderBookHtml(filePath: string, format: BookFormat): Promise<string> {
  const data = await readFile(filePath)
  switch (format) {
    case 'docx':
      return renderDocx(data)
    case 'md':
      return renderMarkdown(decodeText(new Uint8Array(data)))
    case 'txt':
      return renderPlainChapters(splitPlainText(stripGutenberg(decodeText(new Uint8Array(data)))))
    default:
      throw new Error(`${format.toUpperCase()} files are shown by their own reader`)
  }
}
