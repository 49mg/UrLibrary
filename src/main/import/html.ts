import { Parser } from 'htmlparser2'
import { cleanText } from './textUtils'

export interface Block {
  /** 'h1'..'h6' for headings, 'p' for everything else */
  kind: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p'
  text: string
}

const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'figure', 'figcaption', 'table', 'tr', 'td', 'th', 'hr', 'body'
]) // prettier-ignore
const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'noscript', 'template'])
const HEADING = /^h[1-6]$/

/** Converts (X)HTML into ordered text blocks, keeping headings so chapters can be detected. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  let text = ''
  let skipDepth = 0
  let preDepth = 0
  let heading: Block['kind'] | null = null

  const flush = (): void => {
    const lines = text.split('\n').map(cleanText).filter(Boolean)
    if (lines.length) blocks.push({ kind: heading ?? 'p', text: lines.join('\n') })
    text = ''
  }

  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIP.has(name)) {
          skipDepth++
          return
        }
        if (skipDepth) return
        if (name === 'br') {
          text += '\n'
          return
        }
        if (name === 'pre') preDepth++
        if (BLOCK.has(name)) {
          flush()
          if (HEADING.test(name)) heading = name as Block['kind']
        }
      },
      ontext(data) {
        if (skipDepth) return
        // Line breaks in HTML source are just spaces (books often wrap paragraphs at ~70 columns);
        // only <br> and <pre> content break lines.
        text += preDepth ? data : data.replace(/[\r\n\t]+/g, ' ')
      },
      onclosetag(name) {
        if (SKIP.has(name)) {
          skipDepth = Math.max(0, skipDepth - 1)
          return
        }
        if (skipDepth) return
        if (name === 'pre') preDepth = Math.max(0, preDepth - 1)
        if (BLOCK.has(name)) {
          flush()
          if (HEADING.test(name)) heading = null
        }
      }
    },
    { decodeEntities: true, lowerCaseTags: true, recognizeSelfClosing: true }
  )
  parser.write(html)
  parser.end()
  flush()
  return blocks
}

/** Plain text of an HTML fragment (for descriptions and titles). */
export function htmlToText(html: string): string {
  return htmlToBlocks(html)
    .map((b) => b.text)
    .join('\n\n')
}
