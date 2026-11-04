import { Fragment } from 'react'
import { Link } from 'react-router'
import { SNIPPET_END, SNIPPET_START, type SearchResults as Results } from '../../../shared/ipc'
import { BookCover } from './BookCover'
import { locationLabel } from '../lib/format'

/** Renders a snippet with marker characters as <mark>, never as HTML. */
export function Snippet({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(SNIPPET_START)
  return (
    <>
      {parts.map((part, i) => {
        if (i === 0) return <Fragment key={i}>{part}</Fragment>
        const [hit, rest = ''] = part.split(SNIPPET_END)
        return (
          <Fragment key={i}>
            <mark className="rounded-sm bg-accent-soft px-0.5 text-text">{hit}</mark>
            {rest}
          </Fragment>
        )
      })}
    </>
  )
}

export function SearchResults({
  query,
  results
}: {
  query: string
  results: Results | null
}): React.JSX.Element {
  if (!results) return <p className="py-8 text-sm text-muted">Searching…</p>
  const { books, hits } = results
  if (!books.length && !hits.length) {
    return (
      <p className="py-8 text-sm text-muted">
        Nothing found for “{query}”. Books still being read in the background will show up once
        they’re ready.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-8 py-6">
      {books.length > 0 && (
        <section aria-label="Matching books">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Books</h2>
          <ul className="flex flex-wrap gap-3">
            {books.map((b) => (
              <li key={b.id}>
                <Link
                  to={`/reader/${b.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface py-2 pr-4 pl-2 hover:bg-sunken"
                >
                  <div className="h-12 w-8 overflow-hidden rounded-sm">
                    <BookCover book={b} compact />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{b.title}</div>
                    <div className="text-xs text-muted">{b.author ?? '—'}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hits.length > 0 && (
        <section aria-label="Matches inside books">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
            Inside books · {hits.length}
            {hits.length >= 50 ? '+' : ''} {hits.length === 1 ? 'match' : 'matches'}
          </h2>
          <ul className="flex flex-col gap-2">
            {hits.map((h) => (
              <li key={`${h.bookId}-${h.chunkId}`}>
                <Link
                  to={`/reader/${h.bookId}?loc=${encodeURIComponent(h.location)}`}
                  className="block rounded-lg border border-border bg-surface px-4 py-3 hover:bg-sunken"
                >
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                    <span className="font-medium text-text">{h.bookTitle}</span>
                    {h.chapter && !/^Pages? \d/.test(h.chapter) && <span>· {h.chapter}</span>}
                    {locationLabel(h.location) && <span>· {locationLabel(h.location)}</span>}
                  </div>
                  <p className="font-serif text-[15px] leading-relaxed">
                    <Snippet text={h.snippet} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
