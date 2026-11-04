import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, Compass, Loader2, Search, X } from 'lucide-react'
import type { CatalogResult, ProviderId, ProviderInfo } from '../../../shared/ipc'
import { mergeResults, PROVIDER_RANK, type MergedResult } from '../../../shared/discover'
import { EmptyState, PageHeader } from '../components/ui'
import { BookCover } from '../components/BookCover'
import { DiscoverDetails } from '../components/discover/DiscoverDetails'
import { DownloadsPanel } from '../components/discover/DownloadsPanel'
import { useLibrary } from '../stores/library'
import { FILTER_LANGUAGES, PROVIDER_SHORT, langCode, libraryBookFor } from '../lib/discover'
import { cn } from '../lib/cn'
import { Link } from 'react-router'

type ProviderState =
  | { status: 'loading' }
  | { status: 'done'; results: CatalogResult[] }
  | { status: 'error'; message: string }

type FormatFilter = 'any' | 'epub' | 'pdf'
/** `${query}\u0000${provider}` → that source's answer for that query */
type Responses = Record<string, ProviderState>

/** [provider, number of editions] in source order. */
function sourceCounts(m: MergedResult): Array<[ProviderId, number]> {
  const counts = new Map<ProviderId, number>()
  for (const s of m.sources) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1)
  return [...counts]
}

function ResultCard({ m, onOpen }: { m: MergedResult; onOpen: () => void }): React.JSX.Element {
  const books = useLibrary((s) => s.books)
  const inLibrary = libraryBookFor(m, books)
  return (
    <li className="flex flex-col">
      <button
        onClick={onOpen}
        aria-label={`${m.title}${m.authors[0] ? ` by ${m.authors[0]}` : ''}`}
        className="group relative aspect-[2/3] overflow-hidden rounded-md border border-border bg-sunken shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
      >
        <BookCover
          book={{
            title: m.title,
            author: m.authors[0] ?? null,
            coverUrl: m.coverUrl,
            format: 'epub'
          }}
        />
        {inLibrary && (
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 text-xs font-medium text-success shadow">
            <CheckCircle2 size={12} aria-hidden /> In library
          </span>
        )}
      </button>
      <div className="mt-2.5 line-clamp-2 text-sm leading-snug font-medium" title={m.title}>
        {m.title}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted">
        {[m.authors[0], m.year].filter(Boolean).join(' · ') || '—'}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {sourceCounts(m).map(([provider, n]) => (
          <span
            key={provider}
            className="rounded bg-sunken px-1.5 py-0.5 text-[10px] tracking-wide text-muted uppercase"
            title={n > 1 ? `${n} editions` : undefined}
          >
            {PROVIDER_SHORT[provider]}
            {n > 1 ? ` ×${n}` : ''}
          </span>
        ))}
      </div>
    </li>
  )
}

function ProviderChip({
  info,
  state,
  hidden,
  onToggle
}: {
  info: ProviderInfo
  state: ProviderState | undefined
  hidden: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      aria-pressed={!hidden}
      title={state?.status === 'error' ? state.message : info.description}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
        hidden
          ? 'border-border text-muted line-through opacity-60'
          : 'border-border bg-surface text-text hover:bg-sunken'
      )}
    >
      {state?.status === 'loading' && <Loader2 size={12} className="animate-spin" aria-hidden />}
      {state?.status === 'error' && <AlertTriangle size={12} className="text-danger" aria-hidden />}
      {PROVIDER_SHORT[info.id]}
      {state?.status === 'done' && <span className="text-muted">{state.results.length}</span>}
    </button>
  )
}

export function DiscoverPage(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [responses, setResponses] = useState<Responses>({})
  const [hidden, setHidden] = useState<Set<ProviderId>>(new Set())
  const [lang, setLang] = useState<string>('any')
  const [format, setFormat] = useState<FormatFilter>('any')
  const [open, setOpen] = useState<MergedResult | null>(null)

  useEffect(() => {
    window.api.discover
      .providers()
      .then(setProviders)
      .catch(() => setProviders([]))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400)
    return () => clearTimeout(t)
  }, [query])

  // Ask every enabled source in parallel; show each as soon as it answers. Responses are keyed by
  // query, so a source with no answer for the current query simply counts as "loading".
  useEffect(() => {
    if (!providers) return
    const keep = (r: Responses, key: string, value: ProviderState): Responses => {
      const next: Responses = { [key]: value }
      for (const [k, v] of Object.entries(r)) if (k.startsWith(`${debounced}\u0000`)) next[k] = v
      return next
    }
    for (const p of providers.filter((x) => x.enabled)) {
      const key = `${debounced}\u0000${p.id}`
      window.api.discover
        .search(p.id, debounced)
        .then((results) => setResponses((r) => keep(r, key, { status: 'done', results })))
        .catch((e: Error) =>
          setResponses((r) => keep(r, key, { status: 'error', message: e.message }))
        )
    }
  }, [debounced, providers])

  const states = useMemo(
    () =>
      Object.fromEntries(
        (providers ?? [])
          .filter((p) => p.enabled)
          .map((p) => [p.id, responses[`${debounced}\u0000${p.id}`] ?? { status: 'loading' }])
      ) as Partial<Record<ProviderId, ProviderState>>,
    [providers, responses, debounced]
  )

  const merged = useMemo(() => {
    const all = (Object.keys(states) as ProviderId[])
      .sort((a, b) => PROVIDER_RANK[a] - PROVIDER_RANK[b])
      .filter((p) => !hidden.has(p))
      .flatMap((p) => {
        const s = states[p]
        return s?.status === 'done' ? s.results : []
      })
    return mergeResults(all).filter((m) => {
      if (lang !== 'any') {
        const c = langCode(m.language)
        if (c && c !== lang) return false // unknown language stays visible
      }
      if (format !== 'any') {
        const known = m.sources.filter((s) => s.formats.length)
        if (known.length && !known.some((s) => s.formats.some((f) => f.format === format)))
          return false
      }
      return true
    })
  }, [states, hidden, lang, format])

  const enabled = providers?.filter((p) => p.enabled) ?? []
  const loading = Object.values(states).some((s) => s?.status === 'loading')
  const browsing = !debounced

  return (
    <>
      <PageHeader title="Discover" subtitle="Free, public-domain and openly licensed books" />
      <div className="px-10 pb-16">
        <div className="sticky top-0 z-10 -mx-10 flex flex-col gap-3 border-b border-border bg-bg/95 px-10 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                type="search"
                autoFocus
                aria-label="Search free books"
                placeholder="Search by title or author…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setDebounced(query.trim())}
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
            <select
              aria-label="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            >
              <option value="any">Any language</option>
              {FILTER_LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as FormatFilter)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            >
              <option value="any">Any format</option>
              <option value="epub">EPUB</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          {enabled.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sources">
              {enabled.map((p) => (
                <ProviderChip
                  key={p.id}
                  info={p}
                  state={states[p.id]}
                  hidden={hidden.has(p.id)}
                  onToggle={() =>
                    setHidden((h) => {
                      const n = new Set(h)
                      if (n.has(p.id)) n.delete(p.id)
                      else n.add(p.id)
                      return n
                    })
                  }
                />
              ))}
              <Link to="/settings" className="ml-1 text-xs text-muted hover:text-accent">
                Manage sources
              </Link>
            </div>
          )}
        </div>

        <div className="pt-6">
          <DownloadsPanel />
        </div>

        {providers && enabled.length === 0 ? (
          <EmptyState icon={Compass} title="No sources enabled">
            Turn on at least one source in{' '}
            <Link to="/settings" className="text-accent underline">
              Settings
            </Link>
            .
          </EmptyState>
        ) : merged.length === 0 && !loading ? (
          <EmptyState
            icon={BookOpen}
            title={browsing ? 'Nothing to show yet' : `No free books found for “${debounced}”`}
          >
            {browsing
              ? 'Search for a title or an author, like “Pride and Prejudice” or “Dostoevsky”.'
              : 'Try fewer words, another spelling, or the author’s last name. Only public-domain and openly licensed books are listed.'}
          </EmptyState>
        ) : (
          <section aria-label={browsing ? 'Popular and new' : 'Results'} className="pt-6">
            <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
              {browsing
                ? 'Popular and new'
                : `${merged.length} ${merged.length === 1 ? 'book' : 'books'}`}
              {loading && (
                <Loader2
                  size={12}
                  className="ml-2 inline animate-spin"
                  aria-label="Still searching"
                />
              )}
            </h2>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-6 gap-y-8"
              aria-label="Free books"
            >
              {merged.map((m) => (
                <ResultCard key={m.key} m={m} onOpen={() => setOpen(m)} />
              ))}
            </ul>
          </section>
        )}
      </div>
      {open && <DiscoverDetails result={open} onClose={() => setOpen(null)} />}
    </>
  )
}
