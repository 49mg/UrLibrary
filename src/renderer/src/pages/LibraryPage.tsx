import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  ChevronDown,
  FileUp,
  FolderUp,
  LayoutGrid,
  Library,
  List,
  Search,
  Upload,
  X
} from 'lucide-react'
import type { BookSummary, SearchResults as Results } from '../../../shared/ipc'
import { Button, EmptyState, PageHeader } from '../components/ui'
import { BookGrid, BookList, ContinueRow } from '../components/BookGrid'
import { SearchResults } from '../components/SearchResults'
import { Menu } from '../components/Menu'
import { useMenu } from '../lib/useMenu'
import { useBookActions } from '../components/useBookActions'
import { useLibrary } from '../stores/library'
import { useViewPrefs, type SortKey } from '../stores/viewPrefs'
import { importWith } from '../lib/importFlow'
import { toast } from '../stores/toasts'
import { cn } from '../lib/cn'

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function sortBooks(books: BookSummary[], sort: SortKey): BookSummary[] {
  const out = [...books]
  switch (sort) {
    case 'title':
      return out.sort((a, b) => collator.compare(a.title, b.title))
    case 'author':
      return out.sort(
        (a, b) =>
          collator.compare(a.author ?? '￿', b.author ?? '￿') || collator.compare(a.title, b.title)
      )
    case 'added':
      return out.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    default:
      return out.sort((a, b) =>
        (b.lastOpenedAt ?? b.addedAt).localeCompare(a.lastOpenedAt ?? a.addedAt)
      )
  }
}

function ImportButton(): React.JSX.Element {
  const { menu, openBelow, close } = useMenu()
  return (
    <>
      <Button variant="primary" onClick={openBelow} aria-haspopup="menu">
        <Upload size={16} aria-hidden /> Import <ChevronDown size={14} aria-hidden />
      </Button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Import"
          onClose={close}
          entries={[
            {
              kind: 'item',
              label: 'Files…',
              icon: FileUp,
              onSelect: () => void importWith(() => window.api.library.importDialog('files'))
            },
            {
              kind: 'item',
              label: 'A folder…',
              icon: FolderUp,
              onSelect: () => void importWith(() => window.api.library.importDialog('folder'))
            }
          ]}
        />
      )}
    </>
  )
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: Array<[T, string]>
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

export function LibraryPage(): React.JSX.Element {
  const { books, collections, loaded } = useLibrary()
  const prefs = useViewPrefs()
  const [params] = useSearchParams()
  const collectionId = params.get('collection')
  const collection = collections.find((c) => c.id === collectionId) ?? null
  const actions = useBookActions(collectionId)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const searching = query.trim().length >= 2

  useEffect(() => {
    if (!searching) return
    let cancelled = false
    const t = setTimeout(() => {
      window.api.search
        .fullText(query)
        .then((r) => !cancelled && setResults(r))
        .catch((e: Error) => !cancelled && toast.error(`Search failed: ${e.message}`))
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(t)
      setResults(null)
    }
  }, [query, searching])

  const visible = useMemo(() => {
    let list = books
    if (collectionId) list = list.filter((b) => b.collectionIds.includes(collectionId))
    if (prefs.format !== 'all') list = list.filter((b) => b.format === prefs.format)
    if (prefs.status !== 'all') list = list.filter((b) => b.status === prefs.status)
    if (prefs.source !== 'all')
      list = list.filter((b) => (prefs.source === 'local') === (b.source === 'local'))
    return sortBooks(list, prefs.sort)
  }, [books, collectionId, prefs.format, prefs.status, prefs.source, prefs.sort])

  const continueReading = useMemo(
    () =>
      collectionId
        ? []
        : books
            .filter((b) => b.status === 'reading')
            .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
            .slice(0, 6),
    [books, collectionId]
  )

  const filtered = prefs.format !== 'all' || prefs.status !== 'all' || prefs.source !== 'all'
  const title = collection ? collection.name : 'Library'
  const subtitle = !loaded
    ? ' '
    : books.length === 0
      ? 'Your books, notes and AI versions'
      : `${visible.length} ${visible.length === 1 ? 'book' : 'books'}${filtered ? ' (filtered)' : ''}`

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<ImportButton />} />
      {actions.node}

      {loaded && books.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Your library is empty"
          action={
            <Button
              variant="primary"
              onClick={() => void importWith(() => window.api.library.importDialog('files'))}
            >
              <FileUp size={16} aria-hidden /> Import books
            </Button>
          }
        >
          Import your own PDF, EPUB, Word or text files — or drag them anywhere into this window.
          You can also find free public-domain books in Discover.
        </EmptyState>
      ) : (
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
                aria-label="Search titles, authors and the text of your books"
                placeholder="Search titles, authors, text…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                className="w-full rounded-lg border border-border bg-surface py-2 pr-9 pl-9 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-text"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {!searching && (
              <>
                <Select
                  label="Sort"
                  value={prefs.sort}
                  onChange={(sort) => prefs.set({ sort })}
                  options={[
                    ['recent', 'Recently read'],
                    ['added', 'Recently added'],
                    ['title', 'Title'],
                    ['author', 'Author']
                  ]}
                />
                <Select
                  label="Format"
                  value={prefs.format}
                  onChange={(format) => prefs.set({ format })}
                  options={[
                    ['all', 'All formats'],
                    ['pdf', 'PDF'],
                    ['epub', 'EPUB'],
                    ['docx', 'Word'],
                    ['txt', 'Text'],
                    ['md', 'Markdown']
                  ]}
                />
                <Select
                  label="Status"
                  value={prefs.status}
                  onChange={(status) => prefs.set({ status })}
                  options={[
                    ['all', 'Any status'],
                    ['unread', 'Unread'],
                    ['reading', 'Reading'],
                    ['finished', 'Finished']
                  ]}
                />
                <Select
                  label="Source"
                  value={prefs.source}
                  onChange={(source) => prefs.set({ source })}
                  options={[
                    ['all', 'All sources'],
                    ['local', 'My files'],
                    ['online', 'Downloaded']
                  ]}
                />
                <div
                  className="inline-flex rounded-lg border border-border bg-sunken p-0.5"
                  role="group"
                  aria-label="Layout"
                >
                  {(
                    [
                      ['grid', LayoutGrid, 'Grid view'],
                      ['list', List, 'List view']
                    ] as const
                  ).map(([v, Icon, label]) => (
                    <button
                      key={v}
                      aria-label={label}
                      aria-pressed={prefs.view === v}
                      onClick={() => prefs.set({ view: v })}
                      className={cn(
                        'rounded-md p-1.5',
                        prefs.view === v
                          ? 'bg-surface text-text shadow-sm'
                          : 'text-muted hover:text-text'
                      )}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {searching ? (
            <SearchResults query={query.trim()} results={results} />
          ) : (
            <>
              {continueReading.length > 0 && prefs.sort === 'recent' && !filtered && (
                <section className="pt-8" aria-label="Continue reading">
                  <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                    Continue reading
                  </h2>
                  <ContinueRow books={continueReading} />
                </section>
              )}
              <section className="pt-8" aria-label="All books">
                {continueReading.length > 0 && prefs.sort === 'recent' && !filtered && (
                  <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                    All books
                  </h2>
                )}
                {visible.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted">
                    {collection
                      ? 'This collection is empty. Drag books onto it in the sidebar, or use a book’s ⋯ menu.'
                      : 'No books match these filters.'}
                  </p>
                ) : prefs.view === 'grid' ? (
                  <BookGrid books={visible} openMenu={actions.open} />
                ) : (
                  <BookList books={visible} openMenu={actions.open} />
                )}
              </section>
            </>
          )}
        </div>
      )}
    </>
  )
}
