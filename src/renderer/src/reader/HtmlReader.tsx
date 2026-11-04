import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { useLatest } from '../lib/useLatest'
import type { FormatReaderProps, SearchMatch, TocItem } from './types'
import { FONT_STACKS, PAGE_COLORS } from './types'
import { excerpt, findAll } from './search'

// Links inside documents open in the system browser (main process enforces https-only).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (
    node.tagName === 'A' &&
    node.getAttribute('href') &&
    !node.getAttribute('href')!.startsWith('#')
  ) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'style',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'iframe',
      'object',
      'embed'
    ],
    FORBID_ATTR: ['style'],
    // Word images arrive as data: URIs.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/(?:png|jpe?g|gif|webp|bmp);|#)/i
  })
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6'

/** Non-empty headings in document order — the same numbering text extraction uses for `heading:<n>`. */
function headingsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(HEADINGS)].filter((h) => h.textContent?.trim())
}

function buildToc(root: HTMLElement): TocItem[] {
  const sections = [...root.querySelectorAll<HTMLElement>('section[id^="sl-section-"]')]
  if (sections.length > 1) {
    return sections.map((s, i) => ({
      label: s.querySelector('h2')?.textContent?.trim() || `Section ${i + 1}`,
      location: `section:${i}`
    }))
  }
  const hs = headingsOf(root)
  if (!hs.length) return []
  const top = Math.min(...hs.map((h) => Number(h.tagName[1])))
  // Show the two top-most heading levels, nested.
  const items: TocItem[] = []
  hs.forEach((h, n) => {
    const level = Number(h.tagName[1])
    if (level > top + 1) return
    const item = { label: h.textContent!.trim(), location: `heading:${n}` }
    if (level === top || !items.length) items.push(item)
    else (items[items.length - 1].children ??= []).push(item)
  })
  return items
}

/** Text nodes of the document with their running character offsets, for search. */
function textIndex(root: HTMLElement): {
  text: string
  nodes: Array<{ node: Text; start: number }>
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number }> = []
  let text = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length })
    text += (n as Text).data
  }
  return { text, nodes }
}

function rangeFor(index: ReturnType<typeof textIndex>, start: number, end: number): Range | null {
  const at = (offset: number): { node: Text; offset: number } | null => {
    for (let i = index.nodes.length - 1; i >= 0; i--) {
      const n = index.nodes[i]
      if (n.start <= offset)
        return { node: n.node, offset: Math.min(offset - n.start, n.node.data.length) }
    }
    return null
  }
  const a = at(start)
  const b = at(end)
  if (!a || !b) return null
  const r = document.createRange()
  r.setStart(a.node, a.offset)
  r.setEnd(b.node, b.offset)
  return r
}

export function HtmlReader({
  session,
  prefs,
  initialLocation,
  onReady,
  onPosition,
  onError,
  handleRef
}: FormatReaderProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const matches = useRef<Range[]>([])
  // Latest callbacks, so load effects don't re-run when the parent re-renders.
  const cb = useLatest({ onReady, onPosition, onError })

  useEffect(() => {
    let cancelled = false
    window.api.reader
      .html(session.book.id)
      .then((r) => !cancelled && setHtml(sanitize(r.html)))
      .catch((e: Error) => !cancelled && cb.current.onError(e.message))
    return () => {
      cancelled = true
    }
  }, [session.book.id, cb])

  const goTo = (location: string): void => {
    const scroller = scrollRef.current
    const article = articleRef.current
    if (!scroller || !article) return
    let el: HTMLElement | null = null
    const [kind, value] = [
      location.slice(0, location.indexOf(':')),
      location.slice(location.indexOf(':') + 1)
    ]
    if (location === 'start') scroller.scrollTop = 0
    else if (kind === 'heading') el = headingsOf(article)[Number(value)] ?? null
    else if (kind === 'section') el = article.querySelector(`#sl-section-${Number(value)}`)
    else if (kind === 'scroll')
      scroller.scrollTop = Number(value) * (scroller.scrollHeight - scroller.clientHeight)
    else if (kind === 'match') {
      const r = matches.current[Number(value)]
      if (r) {
        const top =
          r.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        scroller.scrollTop = top - scroller.clientHeight / 3
        CSS.highlights?.set('sl-search-current', new Highlight(r))
      }
    }
    if (el) scroller.scrollTop = el.offsetTop - 24
  }

  // Once rendered: TOC, initial position, and position tracking on scroll.
  useEffect(() => {
    const scroller = scrollRef.current
    const article = articleRef.current
    if (!html || !scroller || !article) return
    cb.current.onReady({ toc: buildToc(article) })
    if (initialLocation) goTo(initialLocation)
    let frame = 0
    const report = (): void => {
      frame = 0
      const max = scroller.scrollHeight - scroller.clientHeight
      const progress = max > 0 ? scroller.scrollTop / max : 1
      // Label = last heading above the top of the viewport.
      const hs = headingsOf(article)
      let label = ''
      for (const h of hs) {
        if (h.offsetTop - 40 <= scroller.scrollTop) label = h.textContent!.trim()
        else break
      }
      cb.current.onPosition({
        location: `scroll:${progress.toFixed(4)}`,
        progress,
        label: label || `${Math.round(progress * 100)}%`
      })
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    report()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
    // initialLocation applies once, when the document first renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])

  useImperativeHandle(handleRef, () => ({
    goTo,
    next: () =>
      scrollRef.current?.scrollBy({
        top: scrollRef.current.clientHeight * 0.9,
        behavior: 'smooth'
      }),
    prev: () =>
      scrollRef.current?.scrollBy({
        top: -scrollRef.current.clientHeight * 0.9,
        behavior: 'smooth'
      }),
    search: async (query) => {
      const article = articleRef.current
      if (!article) return []
      const index = textIndex(article)
      const found = findAll(index.text, query, 500)
      matches.current = found
        .map((m) => rangeFor(index, m.start, m.end))
        .filter((r): r is Range => !!r)
      CSS.highlights?.set('sl-search', new Highlight(...matches.current))
      return found.map((m, i): SearchMatch => ({
        location: `match:${i}`,
        excerpt: excerpt(index.text, m.start, m.end)
      }))
    },
    clearSearch: () => {
      matches.current = []
      CSS.highlights?.delete('sl-search')
      CSS.highlights?.delete('sl-search-current')
    }
  }))

  const colors = PAGE_COLORS[prefs.theme]
  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      aria-label="Book text"
      className="sl-html-reader relative h-full overflow-y-auto outline-none"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {html === null ? null : (
        <article
          ref={articleRef}
          className="sl-prose mx-auto max-w-[68ch] px-8 py-16"
          style={{
            fontFamily: FONT_STACKS[prefs.fontFamily],
            fontSize: prefs.fontSize,
            lineHeight: prefs.lineHeight
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}
