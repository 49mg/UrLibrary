import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bookmark, MessageSquare, NotebookPen, Search } from 'lucide-react'
import { HIGHLIGHT_COLORS, type AnnotationWithBook, type HighlightColor } from '../../../shared/ipc'
import { EmptyState, PageHeader } from '../components/ui'
import { HIGHLIGHT_HEX } from '../reader/types'
import { locationLabel } from '../lib/format'
import { toast } from '../stores/toasts'
import { cn } from '../lib/cn'

/**
 * Every highlight, note and bookmark across the library, newest first, grouped by book.
 * Quotes are <p>, not <blockquote>: Chromium leaves blockquote text out of a link's accessible name.
 */
export function NotesPage(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [color, setColor] = useState<HighlightColor | null>(null)
  const [onlyNotes, setOnlyNotes] = useState(false)
  const [items, setItems] = useState<AnnotationWithBook[] | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => window.api.on('annotations:changed', () => setVersion((v) => v + 1)), [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      window.api.annotations
        .search({ query: query.trim() || undefined, color: color ?? undefined })
        .then((r) => !cancelled && setItems(r))
        .catch((e: Error) => toast.error(`Couldn’t load notes: ${e.message}`))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, color, version])

  const groups = useMemo(() => {
    const list = (items ?? []).filter((a) => !onlyNotes || a.note)
    const map = new Map<
      string,
      { title: string; author: string | null; items: AnnotationWithBook[] }
    >()
    for (const a of list) {
      const g = map.get(a.bookId) ?? { title: a.bookTitle, author: a.bookAuthor, items: [] }
      g.items.push(a)
      map.set(a.bookId, g)
    }
    // Within a book, show passages in reading order.
    for (const g of map.values()) g.items.sort((a, b) => a.sortKey - b.sortKey)
    return [...map.entries()]
  }, [items, onlyNotes])

  const total = groups.reduce((n, [, g]) => n + g.items.length, 0)
  const filtering = !!query.trim() || !!color || onlyNotes

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle={
          items === null
            ? ' '
            : `${total} ${total === 1 ? 'item' : 'items'}${filtering ? ' (filtered)' : ''} across your library`
        }
      />
      <div className="px-10 pb-16">
        <div className="sticky top-0 z-10 -mx-10 flex flex-wrap items-center gap-3 border-b border-border bg-bg/95 px-10 py-3 backdrop-blur">
          <div className="relative min-w-60 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              aria-label="Search notes"
              placeholder="Search highlights, notes and book titles…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pr-3 pl-9 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={onlyNotes}
              onChange={(e) => setOnlyNotes(e.target.checked)}
              className="accent-[var(--c-accent)]"
            />
            Only with notes
          </label>
          <div className="flex gap-1.5" role="group" aria-label="Filter by color">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Only ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(color === c ? null : c)}
                className={cn(
                  'size-5 rounded-full ring-offset-2 ring-offset-bg',
                  color === c && 'ring-2 ring-text'
                )}
                style={{ background: HIGHLIGHT_HEX[c] }}
              />
            ))}
          </div>
        </div>

        {items !== null && total === 0 ? (
          filtering ? (
            <p className="py-12 text-center text-sm text-muted">Nothing matches.</p>
          ) : (
            <EmptyState icon={NotebookPen} title="No notes yet">
              While reading, select text to highlight it or add a note. Everything you mark shows up
              here.
            </EmptyState>
          )
        ) : (
          <div className="flex flex-col gap-10 pt-8">
            {groups.map(([bookId, g]) => (
              <section key={bookId} aria-label={g.title}>
                <h2 className="mb-3 flex items-baseline gap-2">
                  <Link to={`/reader/${bookId}`} className="font-serif text-xl hover:text-accent">
                    {g.title}
                  </Link>
                  {g.author && <span className="text-sm text-muted">{g.author}</span>}
                </h2>
                <ul className="flex flex-col gap-2">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <Link
                        to={`/reader/${bookId}?loc=${encodeURIComponent(a.location)}`}
                        className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-sunken"
                      >
                        {a.type === 'bookmark' ? (
                          <Bookmark
                            size={16}
                            className="mt-0.5 shrink-0 text-accent"
                            aria-label="Bookmark"
                          />
                        ) : (
                          <span
                            className="w-1 shrink-0 rounded-full"
                            style={{ background: HIGHLIGHT_HEX[a.color ?? 'yellow'] }}
                            aria-hidden
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {(a.chapter || locationLabel(a.location)) && (
                            <div className="mb-1 text-xs text-muted">
                              {[a.chapter, locationLabel(a.location)].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {a.type === 'bookmark' ? (
                            <div className="text-sm">Bookmark · {Math.round(a.sortKey * 100)}%</div>
                          ) : (
                            <p className="font-serif text-[15px] leading-relaxed">{a.text}</p>
                          )}
                          {a.note && (
                            <p className="mt-2 flex gap-1.5 text-sm whitespace-pre-wrap">
                              <MessageSquare
                                size={14}
                                className="mt-0.5 shrink-0 text-muted"
                                aria-hidden
                              />
                              {a.note}
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
