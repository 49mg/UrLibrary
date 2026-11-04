import { useEffect, useState } from 'react'
import { Library, Upload } from 'lucide-react'
import type { BookSummary } from '../../../shared/ipc'
import { Button, EmptyState, PageHeader } from '../components/ui'
import { toast } from '../stores/toasts'

export function LibraryPage(): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[] | null>(null)

  useEffect(() => {
    window.api.books
      .list()
      .then(setBooks)
      .catch((e: Error) => {
        toast.error(`Could not load library: ${e.message}`)
        setBooks([])
      })
  }, [])

  const importButton = (
    <Button variant="primary" disabled title="Import arrives with SL-16">
      <Upload size={16} aria-hidden /> Import books
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Library"
        subtitle={
          books && books.length > 0 ? `${books.length} books` : 'Your books, notes and AI versions'
        }
        actions={importButton}
      />
      {books === null ? null : books.length === 0 ? (
        <EmptyState icon={Library} title="Your library is empty">
          Import your own PDF, EPUB or Word files, or find free public-domain books in Discover.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6 px-10 py-8">
          {books.map((b) => (
            <li key={b.id} className="flex flex-col gap-2">
              <div className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-sunken">
                {b.coverUrl ? (
                  <img src={b.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center p-3 text-center font-serif text-sm text-muted">
                    {b.title}
                  </div>
                )}
              </div>
              <div className="text-sm leading-tight font-medium">{b.title}</div>
              {b.author && <div className="text-xs text-muted">{b.author}</div>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
