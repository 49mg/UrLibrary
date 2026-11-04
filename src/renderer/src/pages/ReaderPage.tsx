import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { BookOpen } from 'lucide-react'
import type { ReaderSession } from '../../../shared/ipc'
import { Button, EmptyState, PageHeader } from '../components/ui'
import { ReaderView } from '../reader/ReaderView'
import { useLibrary } from '../stores/library'

function NoBook(): React.JSX.Element {
  const books = useLibrary((s) => s.books)
  const last = [...books]
    .filter((b) => b.lastOpenedAt)
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0]
  return (
    <>
      <PageHeader title="Reader" />
      <EmptyState
        icon={BookOpen}
        title="No book open"
        action={
          last && (
            <Link to={`/reader/${last.id}`}>
              <Button variant="primary">Resume “{last.title}”</Button>
            </Link>
          )
        }
      >
        Open a book from your library to start reading.
      </EmptyState>
    </>
  )
}

function OpenBook({
  bookId,
  versionId
}: {
  bookId: string
  versionId: string | null
}): React.JSX.Element {
  const [params] = useSearchParams()
  const target = params.get('loc')
  const [session, setSession] = useState<ReaderSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.reader
      .open(bookId, versionId ?? undefined)
      .then((s) => !cancelled && setSession(s))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [bookId, versionId])

  if (error) {
    return (
      <EmptyState icon={BookOpen} title="Book not found">
        {error}{' '}
        <Link to="/library" className="text-accent underline">
          Back to library
        </Link>
      </EmptyState>
    )
  }
  if (!session) return <div className="h-full" />
  // A location from a search hit wins over the saved reading position.
  return <ReaderView session={session} initialLocation={target ?? session.location} />
}

export function ReaderPage(): React.JSX.Element {
  const { bookId } = useParams()
  const [params] = useSearchParams()
  const versionId = params.get('version')
  if (!bookId) return <NoBook />
  // Key by book so switching books fully remounts (and flushes progress of the previous one).
  return <OpenBook key={`${bookId}:${versionId ?? ''}`} bookId={bookId} versionId={versionId} />
}
