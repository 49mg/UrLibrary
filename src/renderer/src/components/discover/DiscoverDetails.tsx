import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { BookOpen, Download, ExternalLink, Loader2 } from 'lucide-react'
import type { CatalogResult, ProviderId } from '../../../../shared/ipc'
import type { MergedResult } from '../../../../shared/discover'
import { Modal } from '../Modal'
import { Button } from '../ui'
import { BookCover } from '../BookCover'
import { useLibrary } from '../../stores/library'
import { useJobs, activeJobs } from '../../stores/jobs'
import { useDownloads } from '../../stores/downloads'
import {
  PROVIDER_SHORT,
  formatBytes,
  langName,
  libraryBookFor,
  startDownload
} from '../../lib/discover'

type Loaded =
  | { status: 'loading' }
  | { status: 'ok'; item: CatalogResult }
  | { status: 'error'; message: string }

function groupByProvider(sources: CatalogResult[]): Array<[ProviderId, CatalogResult[]]> {
  const map = new Map<ProviderId, CatalogResult[]>()
  for (const s of sources) map.set(s.provider, [...(map.get(s.provider) ?? []), s])
  return [...map]
}

/** The best edition of one source, with the others behind a toggle (each loads only when shown). */
function ProviderGroup({
  sources,
  title
}: {
  sources: CatalogResult[]
  title: string
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [first, ...rest] = sources
  const differs = (s: CatalogResult): boolean =>
    s.title.toLowerCase() !== title.toLowerCase() || !!s.year
  return (
    <>
      <SourceOptions source={first} showEdition={rest.length > 0 || differs(first)} />
      {expanded && rest.map((s) => <SourceOptions key={s.key} source={s} showEdition />)}
      {rest.length > 0 && (
        <li>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="px-1 text-xs text-muted hover:text-accent"
          >
            {expanded
              ? `Hide other ${PROVIDER_SHORT[first.provider]} editions`
              : `${rest.length} more ${rest.length === 1 ? 'edition' : 'editions'} on ${PROVIDER_SHORT[first.provider]}`}
          </button>
        </li>
      )}
    </>
  )
}

function SourceOptions({
  source,
  showEdition = false
}: {
  source: CatalogResult
  showEdition?: boolean
}): React.JSX.Element {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const jobs = useJobs((s) => s.jobs)
  const requests = useDownloads((s) => s.requests)
  const running = activeJobs(jobs).find(
    (j) => requests[j.id]?.provider === source.provider && requests[j.id]?.id === source.id
  )

  useEffect(() => {
    let cancelled = false
    window.api.discover
      .details(source.provider, source.id)
      .then((item) => !cancelled && setState({ status: 'ok', item }))
      .catch((e: Error) => !cancelled && setState({ status: 'error', message: e.message }))
    return () => {
      cancelled = true
    }
  }, [source.provider, source.id])

  const item = state.status === 'ok' ? state.item : source
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {PROVIDER_SHORT[source.provider]}
            {showEdition && (
              <span className="font-normal text-muted">
                {' · '}
                {[source.title, source.year].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted" title={item.license}>
            {item.license}
          </div>
        </div>
        <a
          href={item.pageUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-accent"
        >
          Website <ExternalLink size={12} aria-hidden />
        </a>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state.status === 'loading' && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Checking files…
          </span>
        )}
        {state.status === 'error' && <span className="text-xs text-danger">{state.message}</span>}
        {state.status === 'ok' && state.item.formats.length === 0 && (
          <span className="text-xs text-muted">No downloadable file found.</span>
        )}
        {state.status === 'ok' &&
          state.item.formats.map((f) => (
            <Button
              key={f.format}
              variant={f.format === 'epub' ? 'primary' : 'secondary'}
              disabled={!!running}
              onClick={async () => {
                await startDownload(state.item, f.format)
              }}
            >
              <Download size={15} aria-hidden /> {f.label}
              {f.sizeBytes ? (
                <span className="opacity-75">· {formatBytes(f.sizeBytes)}</span>
              ) : null}
            </Button>
          ))}
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Downloading
            {running.progress !== null ? ` ${Math.round(running.progress * 100)}%` : '…'}
          </span>
        )}
      </div>
    </li>
  )
}

/** Everything about one book across sources, with download buttons per source and format. */
export function DiscoverDetails({
  result,
  onClose
}: {
  result: MergedResult
  onClose: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const books = useLibrary((s) => s.books)
  const inLibrary = libraryBookFor(result, books)
  const [best, setBest] = useState<CatalogResult | null>(null)

  // Description and subjects come from the best source's details.
  useEffect(() => {
    let cancelled = false
    const s = result.sources[0]
    window.api.discover
      .details(s.provider, s.id)
      .then((d) => !cancelled && setBest(d))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [result])

  const info = best ?? result.sources[0]
  const lang = langName(info.language ?? result.language)
  return (
    <Modal title={result.title} onClose={onClose} width="max-w-2xl">
      <div className="flex gap-6">
        <div className="h-48 w-32 shrink-0 overflow-hidden rounded-md border border-border shadow-sm">
          <BookCover
            book={{
              title: result.title,
              author: result.authors[0] ?? null,
              coverUrl: result.coverUrl,
              format: 'epub'
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          {result.authors.length > 0 && <p className="text-sm">{result.authors.join(', ')}</p>}
          <p className="mt-1 text-xs text-muted">
            {[result.year, lang].filter(Boolean).join(' · ')}
          </p>
          {info.description && (
            <p className="mt-3 line-clamp-6 text-sm leading-relaxed text-muted">
              {info.description}
            </p>
          )}
          {info.subjects.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Subjects">
              {info.subjects.slice(0, 6).map((s) => (
                <li key={s} className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">
                  {s}
                </li>
              ))}
            </ul>
          )}
          {inLibrary && (
            <Button
              className="mt-4"
              variant="primary"
              onClick={() => navigate(`/reader/${inLibrary.id}`)}
            >
              <BookOpen size={15} aria-hidden /> Open from your library
            </Button>
          )}
        </div>
      </div>
      <h3 className="mt-6 mb-2 text-xs font-medium tracking-wide text-muted uppercase">Get it</h3>
      <ul className="flex flex-col gap-2" aria-label="Download options">
        {groupByProvider(result.sources).map(([provider, sources]) => (
          <ProviderGroup key={provider} sources={sources} title={result.title} />
        ))}
      </ul>
    </Modal>
  )
}
