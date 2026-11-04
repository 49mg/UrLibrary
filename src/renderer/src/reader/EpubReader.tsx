import { useEffect, useImperativeHandle, useRef } from 'react'
import ePub, { type Book, type Rendition, type NavItem } from 'epubjs'
import { useLatest } from '../lib/useLatest'
import type { FormatReaderProps, SearchMatch, TocItem } from './types'
import { FONT_STACKS, PAGE_COLORS } from './types'
import type { ReaderPrefs } from '../../../shared/ipc'
import { findAll, markRange } from './search'

interface SpineItemLike {
  href: string
  index: number
  load: (request: (path: string) => Promise<object>) => Promise<unknown>
  find: (q: string) => Array<{ cfi: string; excerpt: string }>
  unload: () => void
}

function applyTheme(r: Rendition, p: ReaderPrefs): void {
  const c = PAGE_COLORS[p.theme]
  r.themes.override('color', c.fg, true)
  r.themes.override('background', c.bg, true)
  r.themes.override('line-height', String(p.lineHeight), true)
  r.themes.font(FONT_STACKS[p.fontFamily])
  r.themes.fontSize(`${p.fontSize}px`)
}

/** Cached "locations" (needed for % progress) so big books don't recompute them on every open. */
const LOCATIONS_KEY = (id: string): string => `sl.epubLocations.${id}`

function readCache(id: string): string | null {
  try {
    return localStorage.getItem(LOCATIONS_KEY(id))
  } catch {
    return null
  }
}
function writeCache(id: string, json: string): void {
  try {
    localStorage.setItem(LOCATIONS_KEY(id), json)
  } catch {
    // storage full or unavailable; we'll just regenerate next time
  }
}

/** Normalizes an href to its file: no #fragment, decoded, no leading ./ */
function fileKey(href: string): string {
  let h = href.split('#')[0].replace(/^\.\//, '')
  try {
    h = decodeURIComponent(h)
  } catch {
    // keep as is
  }
  return h
}

/** TOC hrefs (often with #fragments and %-encoding) → title. First entry per file wins. */
function chapterMap(items: NavItem[], map = new Map<string, string>()): Map<string, string> {
  for (const i of items) {
    const key = fileKey(i.href)
    if (!map.has(key)) map.set(key, i.label.trim())
    if (i.subitems?.length) chapterMap(i.subitems, map)
  }
  return map
}

function toToc(items: NavItem[]): TocItem[] {
  return items.map((i) => ({
    label: i.label.trim(),
    location: `nav:${i.href}`,
    children: i.subitems?.length ? toToc(i.subitems) : undefined
  }))
}

/** Our stored `href:` locations are full paths inside the zip; epub.js wants spine-relative hrefs. */
function spineHrefFor(book: Book, zipPath: string): string | null {
  const items = (book.spine as unknown as { spineItems: SpineItemLike[] }).spineItems
  const hit = items.find((it) => ('/' + zipPath).endsWith('/' + decodeURIComponent(it.href)))
  return hit?.href ?? null
}

/** Turns a saved/target location into something rendition.display() understands. */
function displayTarget(book: Book, location: string | null): string | undefined {
  if (!location) return undefined
  if (location.startsWith('cfi:')) return location.slice(4)
  if (location.startsWith('nav:')) return location.slice(4)
  if (location.startsWith('href:')) return spineHrefFor(book, location.slice(5)) ?? undefined
  return undefined
}

export function EpubReader({
  session,
  prefs,
  initialLocation,
  onReady,
  onPosition,
  onError,
  onKey,
  handleRef
}: FormatReaderProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const highlights = useRef<string[]>([])
  // Latest callbacks, so load effects don't re-run when the parent re-renders.
  const cb = useLatest({ onReady, onPosition, onError, onKey })
  const prefsRef = useLatest(prefs)
  const lastCfi = useRef<string | null>(null)
  /** Content file → chapter title, for the position label and search results. */
  const chapterOf = useRef(new Map<string, string>())

  // (Re)create the rendition when the book or the flow mode changes; flow can't change in place.
  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    void (async () => {
      let book = bookRef.current
      if (!book) {
        try {
          const data = await (await fetch(session.fileUrl)).arrayBuffer()
          if (cancelled) return
          book = ePub(data)
          await book.ready
        } catch (e) {
          if (!cancelled) cb.current.onError(`Couldn’t open this EPUB: ${(e as Error).message}`)
          return
        }
        if (cancelled) return
        bookRef.current = book
        const nav = await book.loaded.navigation
        chapterOf.current = chapterMap(nav.toc)
        cb.current.onReady({ toc: toToc(nav.toc) })
        const cached = readCache(session.book.id)
        if (cached) book.locations.load(cached)
        else {
          // Runs in the background; progress % becomes available when it finishes.
          void book.locations
            .generate(1600)
            .then(() => writeCache(session.book.id, book!.locations.save()))
        }
      }
      host.innerHTML = ''
      const rendition = book.renderTo(host, {
        width: '100%',
        height: '100%',
        flow: prefsRef.current.flow === 'scrolled' ? 'scrolled-doc' : 'paginated',
        spread: 'none',
        allowScriptedContent: false
      } as Parameters<Book['renderTo']>[1])
      renditionRef.current = rendition
      applyTheme(rendition, prefsRef.current)

      rendition.on(
        'relocated',
        (loc: {
          start: { cfi: string; href: string; displayed: { page: number; total: number } }
        }) => {
          lastCfi.current = loc.start.cfi
          const b = bookRef.current
          const hasLocations = !!b && b.locations.length() > 0
          const progress = hasLocations ? b.locations.percentageFromCfi(loc.start.cfi) : 0
          const chapter = chapterOf.current.get(fileKey(loc.start.href))
          cb.current.onPosition({
            location: `cfi:${loc.start.cfi}`,
            progress,
            label: chapter || (hasLocations ? `${Math.round(progress * 100)}%` : '')
          })
        }
      )
      rendition.on('keydown', (e: KeyboardEvent) => cb.current.onKey(e))

      const start = lastCfi.current ?? displayTarget(book, initialLocation)
      try {
        await rendition.display(start)
      } catch {
        await rendition.display() // bad saved location: start from the beginning
      }
    })()
    return () => {
      cancelled = true
      renditionRef.current?.destroy()
      renditionRef.current = null
    }
    // initialLocation is only used on first display; later moves go through goTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.fileUrl, prefs.flow])

  useEffect(() => () => bookRef.current?.destroy(), [])

  // Typography and colors apply live.
  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, prefs)
  }, [prefs])

  const clearHighlights = (): void => {
    for (const cfi of highlights.current) renditionRef.current?.annotations.remove(cfi, 'highlight')
    highlights.current = []
  }

  useImperativeHandle(handleRef, () => ({
    goTo: (location) => {
      const book = bookRef.current
      const target = book ? displayTarget(book, location) : undefined
      if (target) void renditionRef.current?.display(target)
    },
    next: () => void renditionRef.current?.next(),
    prev: () => void renditionRef.current?.prev(),
    search: async (query, signal) => {
      const book = bookRef.current
      if (!book) return []
      const items = (book.spine as unknown as { spineItems: SpineItemLike[] }).spineItems
      const out: SearchMatch[] = []
      for (const item of items) {
        if (signal.aborted || out.length >= 300) break
        try {
          await item.load(book.load.bind(book))
          const label = chapterOf.current.get(fileKey(item.href))
          // epub.js gives every match in a passage the same plain excerpt; mark the n-th
          // occurrence for the n-th repeat so each result highlights its own match.
          const seen = new Map<string, number>()
          for (const r of item.find(query.trim()).slice(0, 50)) {
            const nth = seen.get(r.excerpt) ?? 0
            seen.set(r.excerpt, nth + 1)
            const hits = findAll(r.excerpt, query)
            const m = hits[Math.min(nth, hits.length - 1)]
            const ex = m ? markRange(r.excerpt, m.start, m.end) : r.excerpt
            out.push({ location: `cfi:${r.cfi}`, excerpt: ex, label })
          }
        } finally {
          item.unload()
        }
      }
      return out
    },
    showMatch: (_query, match) => {
      clearHighlights()
      const cfi = match.location.slice(4)
      renditionRef.current?.annotations.highlight(cfi, {}, undefined, 'sl-epub-hit', {
        fill: '#e08a5c',
        'fill-opacity': '0.35'
      })
      highlights.current.push(cfi)
    },
    clearSearch: clearHighlights
  }))

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      style={{ background: PAGE_COLORS[prefs.theme].bg }}
    />
  )
}
