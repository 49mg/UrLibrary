import MarkdownIt from 'markdown-it'
/** markdown-it's token type, taken from the library's own typings. */
type Token = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number]
import {
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType
} from 'docx'
import { renderMarkdown } from '../import/markdown'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

const HEADINGS = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6
} as const

/** Inline Markdown (bold, italic, code, line breaks) → Word runs. */
function runs(inline: Token | undefined): TextRun[] {
  const out: TextRun[] = []
  let bold = 0
  let italic = 0
  for (const t of inline?.children ?? []) {
    switch (t.type) {
      case 'strong_open':
        bold++
        break
      case 'strong_close':
        bold--
        break
      case 'em_open':
        italic++
        break
      case 'em_close':
        italic--
        break
      case 'text':
        if (t.content)
          out.push(new TextRun({ text: t.content, bold: bold > 0, italics: italic > 0 }))
        break
      case 'code_inline':
        out.push(new TextRun({ text: t.content, font: 'Consolas' }))
        break
      case 'softbreak':
        out.push(new TextRun({ text: ' ' }))
        break
      case 'hardbreak':
        out.push(new TextRun({ text: '', break: 1 }))
        break
    }
  }
  return out
}

/** A Word document from Markdown, with real headings (navigable in Word) and real lists. */
export async function markdownToDocx(title: string, markdown: string): Promise<Buffer> {
  const tokens = md.parse(markdown, {})
  const children: Paragraph[] = []
  const lists: Array<'bullet' | 'ordered'> = []
  let quote = 0
  let orderedId = 0
  let currentOrdered = ''

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    switch (t.type) {
      case 'heading_open':
        children.push(
          new Paragraph({
            heading: HEADINGS[t.tag as keyof typeof HEADINGS],
            children: runs(tokens[i + 1])
          })
        )
        i += 2
        break
      case 'bullet_list_open':
        lists.push('bullet')
        break
      case 'ordered_list_open':
        lists.push('ordered')
        currentOrdered = `ol-${orderedId++}`
        break
      case 'bullet_list_close':
      case 'ordered_list_close':
        lists.pop()
        break
      case 'blockquote_open':
        quote++
        break
      case 'blockquote_close':
        quote--
        break
      case 'paragraph_open': {
        const inline = tokens[i + 1]
        const level = Math.max(0, lists.length - 1)
        const kind = lists[lists.length - 1]
        children.push(
          new Paragraph({
            children: runs(inline),
            ...(kind === 'bullet' ? { bullet: { level } } : {}),
            ...(kind === 'ordered' ? { numbering: { reference: currentOrdered, level } } : {}),
            ...(quote ? { indent: { left: 720 }, style: 'Quote' } : {}),
            spacing: { after: 160 }
          })
        )
        i += 2
        break
      }
      case 'fence':
      case 'code_block':
        for (const line of t.content.replace(/\n$/, '').split('\n')) {
          children.push(
            new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] })
          )
        }
        break
      case 'hr':
        children.push(
          new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER })
        )
        break
    }
  }

  const doc = new Document({
    title,
    creator: 'Ur Library',
    numbering: {
      config: Array.from({ length: orderedId }, (_, n) => ({
        reference: `ol-${n}`,
        levels: [0, 1, 2].map((level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
        }))
      }))
    },
    sections: [{ children }]
  })
  return Packer.toBuffer(doc)
}

const escape = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )

/** A print-ready HTML page for PDF export: book typography, each chapter on a new page. */
export function versionHtml(title: string, markdown: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Noto Serif', serif;
         font-size: 11.5pt; line-height: 1.55; color: #1d1b17; }
  h1 { font-size: 22pt; margin: 0 0 6pt; }
  h2 { font-size: 15pt; margin: 18pt 0 8pt; break-before: page; }
  h1 + p + h2, h1 + h2 { break-before: avoid; }
  h3 { font-size: 12.5pt; }
  p { margin: 0 0 8pt; orphans: 3; widows: 3; text-align: justify; hyphens: auto; }
  blockquote { margin: 0 0 8pt 14pt; font-style: italic; }
  pre, code { font-family: Consolas, monospace; font-size: 9.5pt; }
  ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
</style></head>
<body>${renderMarkdown(markdown)}</body></html>`
}
