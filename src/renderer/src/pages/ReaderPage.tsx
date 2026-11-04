import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, BookOpen } from 'lucide-react'
import type { BookDetails } from '../../../shared/ipc'
import { EmptyState, PageHeader } from '../components/ui'
import { BookCover } from '../components/BookCover'
import { TextStatusBadge } from '../components/BookStatus'
import { FORMAT_LABEL, locationLabel } from '../lib/format'
import { useLibrary } from '../stores/library'

/**
 * Placeholder until the real readers land (epic SL-3). Shows which book and location was requested,
 * so links from search already work end to end.
 */
export function ReaderPage(): React.JSX.Element {
  const { bookId } = useParams()
  const [params] = useSearchParams()
  const loc = params.get('loc')
  const [book, setBook] = useState<BookDetails | null | 'missing'>(null)
  const version = useLibrary((s) => s.books.find((b) => b.id === bookId))

  useEffect(() => {
    if (!bookId) return
    window.api.books
      .get(bookId)
      .then(setBook)
      .catch(() => setBook('missing'))
  }, [bookId, version])

  if (!bookId) {
    return (
      <>
        <PageHeader title="Reader" />
        <EmptyState icon={BookOpen} title="No book open">
          Open a book from your library to start reading.
        </EmptyState>
      </>
    )
  }
  if (book === 'missing') {
    return (
      <EmptyState icon={BookOpen} title="Book not found">
        It may have been deleted.{' '}
        <Link to="/library" className="text-accent underline">
          Back to library
        </Link>
      </EmptyState>
    )
  }
  if (!book) return <div />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-10 py-10">
      <Link
        to="/library"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Library
      </Link>
      <div className="flex gap-8">
        <div className="h-60 w-40 shrink-0 overflow-hidden rounded-md border border-border shadow-md">
          <BookCover book={book} />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl leading-tight">{book.title}</h1>
          {book.author && <p className="text-muted">{book.author}</p>}
          <p className="text-sm text-muted">
            {FORMAT_LABEL[book.format]}
            {book.pageCount ? ` · ${book.pageCount} pages` : ''}
            {book.wordCount ? ` · ${book.wordCount.toLocaleString()} words` : ''}
          </p>
          <TextStatusBadge book={book} />
          {book.description && <p className="mt-2 text-sm leading-relaxed">{book.description}</p>}
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted">
        The reader for {FORMAT_LABEL[book.format]} files arrives in the next epic.
        {loc && (
          <span className="mt-2 block">
            It will open at <span className="text-text">{locationLabel(loc) || loc}</span>.
          </span>
        )}
      </div>
    </div>
  )
}
