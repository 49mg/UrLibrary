import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { cn } from '../lib/cn'

// Raw HTML in model output is never rendered; DOMPurify is a second safety net.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

export function Markdown({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const html = useMemo(() => DOMPurify.sanitize(md.render(text)), [text])
  return <div className={cn('sl-prose', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
