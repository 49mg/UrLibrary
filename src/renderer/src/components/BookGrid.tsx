import { MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { BookSummary } from '../../../shared/ipc'
import { BookCover } from './BookCover'
import { TextStatusBadge } from './BookStatus'
import { FORMAT_LABEL } from '../lib/format'
import { cn } from '../lib/cn'

export const BOOK_DRAG_TYPE = 'application/x-ur-library-book'

type OpenMenu = (book: BookSummary, at: { x: number; y: number }) => void

function dragProps(book: BookSummary): React.HTMLAttributes<HTMLElement> & { draggable: boolean } {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(BOOK_DRAG_TYPE, book.id)
      e.dataTransfer.effectAllowed = 'copy'
    }
  }
}

function MoreButton({
  book,
  openMenu
}: {
  book: BookSummary
  openMenu: OpenMenu
}): React.JSX.Element {
  return (
    <button
      aria-label={`More actions for ${book.title}`}
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        openMenu(book, { x: r.left, y: r.bottom + 4 })
      }}
      className="rounded-md p-1 text-muted hover:bg-sunken hover:text-text"
    >
      <MoreHorizontal size={16} />
    </button>
  )
}

function Progress({ value }: { value: number }): React.JSX.Element | null {
  if (value <= 0) return null
  return (
    <div
      className="absolute inset-x-0 bottom-0 h-1 bg-black/20"
      aria-label={`${Math.round(value * 100)}% read`}
    >
      <div className="h-full bg-accent" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  )
}

export function BookGrid({
  books,
  openMenu
}: {
  books: BookSummary[]
  openMenu: OpenMenu
}): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-6 gap-y-8"
      aria-label="Books"
    >
      {books.map((b) => (
        <li key={b.id} className="group flex flex-col">
          <button
            {...dragProps(b)}
            onClick={() => navigate(`/reader/${b.id}`)}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu(b, { x: e.clientX, y: e.clientY })
            }}
            className="relative aspect-[2/3] overflow-hidden rounded-md border border-border bg-sunken shadow-sm transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md"
            aria-label={`Open ${b.title}`}
          >
            <BookCover book={b} />
            <Progress value={b.progress} />
          </button>
          <div className="mt-2.5 flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm leading-snug font-medium" title={b.title}>
                {b.title}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted">
                {b.author ?? FORMAT_LABEL[b.format]}
              </div>
              <div className="mt-1">
                <TextStatusBadge book={b} />
              </div>
            </div>
            <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <MoreButton book={b} openMenu={openMenu} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function BookList({
  books,
  openMenu
}: {
  books: BookSummary[]
  openMenu: OpenMenu
}): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <ul
      className="divide-y divide-border rounded-lg border border-border bg-surface"
      aria-label="Books"
    >
      {books.map((b) => (
        <li
          key={b.id}
          {...dragProps(b)}
          onContextMenu={(e) => {
            e.preventDefault()
            openMenu(b, { x: e.clientX, y: e.clientY })
          }}
          className="flex items-center gap-4 px-4 py-2.5 hover:bg-sunken/60"
        >
          <button
            onClick={() => navigate(`/reader/${b.id}`)}
            className="flex min-w-0 flex-1 items-center gap-4 text-left"
            aria-label={`Open ${b.title}`}
          >
            <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-sm border border-border">
              <BookCover book={b} compact />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{b.title}</div>
              <div className="truncate text-xs text-muted">{b.author ?? '—'}</div>
            </div>
          </button>
          <div className="hidden w-36 shrink-0 md:block">
            <TextStatusBadge book={b} />
          </div>
          <span className="w-20 shrink-0 text-xs text-muted">{FORMAT_LABEL[b.format]}</span>
          <span
            className={cn(
              'w-16 shrink-0 text-right text-xs',
              b.status === 'unread' ? 'text-muted' : 'text-text'
            )}
          >
            {b.status === 'finished'
              ? 'Finished'
              : b.progress > 0
                ? `${Math.round(b.progress * 100)}%`
                : b.status === 'reading'
                  ? 'Reading'
                  : 'Unread'}
          </span>
          <MoreButton book={b} openMenu={openMenu} />
        </li>
      ))}
    </ul>
  )
}

/** Compact horizontal row of books in progress, shown above the full library. */
export function ContinueRow({ books }: { books: BookSummary[] }): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <ul className="flex gap-4 overflow-x-auto pb-2" aria-label="Books in progress">
      {books.map((b) => (
        <li key={b.id} className="shrink-0">
          <button
            onClick={() => navigate(`/reader/${b.id}`)}
            className="flex w-72 items-center gap-4 rounded-lg border border-border bg-surface p-3 text-left hover:bg-sunken"
            aria-label={`Continue ${b.title}`}
          >
            <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-sm border border-border">
              <BookCover book={b} compact />
            </div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm leading-snug font-medium">{b.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted">
                {b.author ?? FORMAT_LABEL[b.format]}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-border">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.round(b.progress * 100)}%` }}
                />
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
