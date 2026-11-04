import MarkdownIt from 'markdown-it'

/**
 * Markdown → HTML used by both the reader and text extraction, so heading positions
 * (`heading:<n>` locations) match exactly. Raw HTML inside Markdown is disabled.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

export function renderMarkdown(source: string): string {
  return md.render(source)
}
