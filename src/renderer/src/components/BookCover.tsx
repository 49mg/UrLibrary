import { useState } from 'react'
import type { BookSummary } from '../../../shared/ipc'
import { cn } from '../lib/cn'
import { FORMAT_LABEL } from '../lib/format'

/** Muted, paper-like cover colors. Picked deterministically from the title so a book keeps its color. */
const PALETTE = [
  ['#7a3b2e', '#f4e6d8'],
  ['#2f4a5c', '#e3edf2'],
  ['#4b5a2e', '#eef0dc'],
  ['#5b3a5e', '#f0e4f0'],
  ['#8a6420', '#f7ecd2'],
  ['#2e5a50', '#dcefe9'],
  ['#3d3a6b', '#e6e5f5'],
  ['#6b2f3f', '#f5e1e6']
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function BookCover({
  book,
  className,
  compact
}: {
  book: BookSummary
  className?: string
  /** Thumbnail size: show only the color and initial, since text would be unreadable. */
  compact?: boolean
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (book.coverUrl && !failed) {
    return (
      <img
        src={book.coverUrl}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', className)}
      />
    )
  }
  const [bg, fg] = PALETTE[hash(book.title) % PALETTE.length]
  if (compact) {
    return (
      <div
        className={cn('flex size-full items-center justify-center font-serif text-base', className)}
        style={{ background: bg, color: fg }}
        aria-hidden
      >
        {book.title.trim().charAt(0).toUpperCase()}
      </div>
    )
  }
  return (
    <div
      className={cn('flex size-full flex-col justify-between p-[9%] text-left', className)}
      style={{ background: bg, color: fg }}
      aria-hidden
    >
      <div className="h-px w-1/3 opacity-60" style={{ background: fg }} />
      <div className="line-clamp-5 font-serif text-[clamp(11px,1.05vw,16px)] leading-snug">
        {book.title}
      </div>
      <div className="truncate text-[10px] tracking-wide uppercase opacity-75">
        {book.author ?? FORMAT_LABEL[book.format]}
      </div>
    </div>
  )
}
