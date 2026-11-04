import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  NotebookPen,
  ChevronLeft,
  ChevronRight,
  GalleryVerticalEnd,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Search,
  Sparkles,
  Type,
  X
} from 'lucide-react'
import type { ReaderPrefs, ReaderSession } from '../../../shared/ipc'
import type { HighlightColor } from '../../../shared/ipc'
import type { PendingSelection, ReaderHandle, ReaderPosition, SearchMatch, TocItem } from './types'
import { HighlightPopover, type PopoverState } from './HighlightPopover'
import { NotesPanel } from './NotesPanel'
import { useAnnotations } from './useAnnotations'
import { AskAiPanel } from './AskAiPanel'
import { ExportMenu } from '../components/ai/JobView'
import { useLatest } from '../lib/useLatest'
import { PAGE_COLORS } from './types'
import { PdfReader } from './PdfReader'
import { EpubReader } from './EpubReader'
import { HtmlReader } from './HtmlReader'
import { zoomStep } from './zoom'
import { Snippet } from '../components/SearchResults'
import { useUi } from '../stores/ui'
import { toast } from '../stores/toasts'
import { cn } from '../lib/cn'

const SAVE_DELAY = 1200

function IconButton({
  label,
  active,
  onClick,
  children,
  disabled
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md p-2 transition-colors disabled:opacity-40',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-text'
      )}
    >
      {children}
    </button>
  )
}

function TocTree({
  items,
  onSelect,
  depth = 0
}: {
  items: TocItem[]
  onSelect: (l: string) => void
  depth?: number
}): React.JSX.Element {
  return (
    <ul className={cn(depth > 0 && 'ml-3 border-l border-border pl-2')}>
      {items.map((item, i) => (
        <li key={`${item.location}-${i}`}>
          <button
            onClick={() => onSelect(item.location)}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm leading-snug hover:bg-sunken"
          >
            {item.label}
          </button>
          {item.children && <TocTree items={item.children} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

function SearchPanel({
  handle,
  onClose
}: {
  handle: React.RefObject<ReaderHandle | null>
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState(-1)
  // Results only count for the query they were computed for.
  const active = query.trim().length >= 2
  const shown = active ? results : null

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      handle.current?.clearSearch()
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = (await handle.current?.search(q, ctrl.signal)) ?? []
        if (!ctrl.signal.aborted) {
          setResults(r)
          setCurrent(-1)
        }
      } finally {
        if (!ctrl.signal.aborted) setBusy(false)
      }
    }, 300)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [query, handle])

  useEffect(() => () => handle.current?.clearSearch(), [handle])

  const open = (i: number): void => {
    if (!shown?.[i]) return
    setCurrent(i)
    handle.current?.goTo(shown[i].location)
    handle.current?.showMatch?.(query.trim(), shown[i])
  }

  return (
    <aside
      aria-label="Search in book"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Search size={16} className="shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          type="search"
          aria-label="Search in this book"
          placeholder="Search in this book…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && shown?.length)
              open(e.shiftKey ? Math.max(0, current - 1) : (current + 1) % shown.length)
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70 [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          onClick={onClose}
          aria-label="Close search"
          className="rounded p-1 text-muted hover:text-text"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-2 text-xs text-muted" role="status">
        {busy
          ? 'Searching…'
          : shown === null
            ? 'Type at least 2 characters. Enter jumps to the next match.'
            : shown.length === 0
              ? 'No matches.'
              : `${shown.length}${shown.length >= 300 ? '+' : ''} ${shown.length === 1 ? 'match' : 'matches'}`}
      </div>
      <ol className="flex-1 overflow-y-auto px-2 pb-4">
        {shown?.map((r, i) => (
          <li key={`${r.location}-${i}`}>
            <button
              onClick={() => open(i)}
              aria-current={i === current ? 'true' : undefined}
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-[13px] leading-relaxed',
                i === current ? 'bg-accent-soft' : 'hover:bg-sunken'
              )}
            >
              {r.label && <div className="mb-0.5 text-xs text-muted">{r.label}</div>}
              <Snippet text={r.excerpt} />
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}

function Segment<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded-lg border border-border bg-sunken p-0.5"
      >
        {options.map(([v, l]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-sm',
              value === v
                ? 'bg-surface font-medium shadow-sm ring-1 ring-border'
                : 'text-muted hover:text-text'
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

function DisplayPopover({
  prefs,
  format,
  onChange,
  onClose
}: {
  prefs: ReaderPrefs
  format: ReaderSession['book']['format']
  onChange: (p: Partial<ReaderPrefs>) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[data-display-toggle]')
      )
        onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const text = format !== 'pdf'
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Display settings"
      className="absolute top-full right-0 z-30 mt-2 flex w-72 flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-xl"
    >
      <Segment
        label="Page"
        value={prefs.theme}
        onChange={(theme) => onChange({ theme })}
        options={[
          ['light', 'Light'],
          ['sepia', 'Sepia'],
          ['dark', 'Dark']
        ]}
      />
      {text && (
        <>
          <Segment
            label="Font"
            value={prefs.fontFamily}
            onChange={(fontFamily) => onChange({ fontFamily })}
            options={[
              ['serif', 'Serif'],
              ['sans', 'Sans-serif']
            ]}
          />
          <div>
            <div className="mb-1.5 flex justify-between text-xs font-medium text-muted">
              <span>Size</span>
              <span>{prefs.fontSize}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                aria-label="Smaller text"
                onClick={() => onChange({ fontSize: Math.max(12, prefs.fontSize - 1) })}
                className="rounded-md border border-border p-1.5 hover:bg-sunken"
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={12}
                max={32}
                aria-label="Text size"
                value={prefs.fontSize}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                className="flex-1 accent-[var(--c-accent)]"
              />
              <button
                aria-label="Larger text"
                onClick={() => onChange({ fontSize: Math.min(32, prefs.fontSize + 1) })}
                className="rounded-md border border-border p-1.5 hover:bg-sunken"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          <Segment
            label="Line spacing"
            value={String(prefs.lineHeight)}
            onChange={(v) => onChange({ lineHeight: Number(v) })}
            options={[
              ['1.35', 'Tight'],
              ['1.6', 'Normal'],
              ['1.9', 'Loose']
            ]}
          />
        </>
      )}
      {format === 'epub' && (
        <Segment
          label="Layout"
          value={prefs.flow}
          onChange={(flow) => onChange({ flow })}
          options={[
            ['paginated', 'Pages'],
            ['scrolled', 'Scroll']
          ]}
        />
      )}
    </div>
  )
}

export function ReaderView({
  session,
  initialLocation
}: {
  session: ReaderSession
  initialLocation: string | null
}): React.JSX.Element {
  const { book } = session
  const navigate = useNavigate()
  const handle = useRef<ReaderHandle | null>(null)
  const { focusMode, setFocusMode } = useUi()
  const [prefs, setPrefs] = useState(session.prefs)
  const [toc, setToc] = useState<TocItem[] | null>(null)
  const [position, setPosition] = useState<ReaderPosition | null>(null)
  const [panel, setPanel] = useState<'toc' | 'pages' | null>(null)
  const [searchOpen, setSearchOpenRaw] = useState(false)
  const [notesOpen, setNotesOpenRaw] = useState(false)
  // Search and notes share the right-hand side; opening one closes the other.
  const setSearchOpen = useCallback((v: boolean) => {
    setSearchOpenRaw(v)
    if (v) setNotesOpenRaw(false)
  }, [])
  const setNotesOpen = useCallback((v: boolean) => {
    setNotesOpenRaw(v)
    if (v) setSearchOpenRaw(false)
  }, [])

  // ---- highlights, notes, bookmarks ----
  const version = session.version
  const { annotations, create, update, remove } = useAnnotations(book.id, version?.id ?? null)
  const [asking, setAsking] = useState<PendingSelection | null>(null)
  const annRef = useLatest(annotations)
  const [pop, setPop] = useState<PopoverState | null>(null)
  const [bookmarkId, setBookmarkId] = useState<string | null>(null)
  const findBookmark = useCallback(
    () =>
      annRef.current.find((a) => a.type === 'bookmark' && handle.current?.isAt(a.location))?.id ??
      null,
    [annRef]
  )
  const onSelection = useCallback((sel: PendingSelection | null) => {
    setPop(sel ? { mode: 'new', sel } : null)
  }, [])
  const onAnnotationClick = useCallback((id: string, rect: PendingSelection['rect']) => {
    setPop({ mode: 'edit', id, rect })
  }, [])
  const createHighlight = async (color: HighlightColor, withNote: boolean): Promise<void> => {
    if (pop?.mode !== 'new') return
    const { sel } = pop
    const created = await create({
      type: 'highlight',
      anchor: sel.anchor,
      location: sel.location,
      chapter: sel.chapter,
      sortKey: sel.sortKey,
      text: sel.text,
      color
    })
    sel.clear()
    setPop(
      created && withNote ? { mode: 'edit', id: created.id, rect: sel.rect, editing: true } : null
    )
  }
  const toggleBookmark = async (): Promise<void> => {
    if (bookmarkId) {
      await remove(bookmarkId)
      setBookmarkId(null)
      return
    }
    if (!position) return
    const created = await create({
      type: 'bookmark',
      anchor: { kind: 'location' },
      location: position.location,
      // "Page 3 of 10" isn't a chapter; the notes list shows the page from the location instead.
      chapter:
        /^Page \d+ of \d+$/.test(position.label) || /^\d+%$/.test(position.label)
          ? null
          : position.label || null,
      sortKey: position.progress
    })
    if (created) {
      setBookmarkId(created.id)
      toast.success('Bookmarked.')
    }
  }
  const [displayOpen, setDisplayOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- progress saving (debounced, flushed on leave) ----
  const pending = useRef<ReaderPosition | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pending.current
    pending.current = null
    // Reading an AI version doesn't move the bookmark-less position of the original book.
    if (p && !version) {
      window.api.reader.saveProgress(book.id, p.location, p.progress).catch(() => undefined)
    }
  }, [book.id, version])
  const onPosition = useCallback(
    (p: ReaderPosition) => {
      setPosition(p)
      setBookmarkId(findBookmark())
      pending.current = p
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY)
    },
    [flush, findBookmark]
  )
  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flush])

  // ---- per-book display prefs (applied instantly, saved debounced) ----
  const prefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefsPatch = useRef<Partial<ReaderPrefs>>({})
  const updatePrefs = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      setPrefs((p) => ({ ...p, ...patch }))
      prefsPatch.current = { ...prefsPatch.current, ...patch }
      if (prefsTimer.current) clearTimeout(prefsTimer.current)
      prefsTimer.current = setTimeout(() => {
        const p = prefsPatch.current
        prefsPatch.current = {}
        window.api.reader.savePrefs(book.id, p).catch((e: Error) => toast.error(e.message))
      }, 400)
    },
    [book.id]
  )

  // ---- keyboard ----
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Typing in a field or the notebook editor must not turn pages.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === 'ArrowRight' || (e.key === 'PageDown' && book.format === 'epub')) {
        if (book.format !== 'pdf' && book.format !== 'epub') return // HTML scrolls natively
        e.preventDefault()
        handle.current?.next()
      } else if (e.key === 'ArrowLeft' || (e.key === 'PageUp' && book.format === 'epub')) {
        if (book.format !== 'pdf' && book.format !== 'epub') return
        e.preventDefault()
        handle.current?.prev()
      } else if (e.key === 'Escape' && focusMode) {
        setFocusMode(false)
      } else if (e.key === 'F11' || (mod && e.shiftKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault()
        setFocusMode(!focusMode)
      }
    },
    [book.format, focusMode, setFocusMode, setSearchOpen]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  // Leaving fullscreen with the browser's own Esc also leaves focus mode; leaving the reader too.
  useEffect(() => {
    const onFs = (): void => {
      if (!document.fullscreenElement) useUi.getState().setFocusMode(false)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      useUi.getState().setFocusMode(false)
    }
  }, [])

  const onReady = useCallback(({ toc }: { toc: TocItem[] }) => setToc(toc), [])

  // A new target while this book is already open (e.g. another search hit): jump there.
  const firstTarget = useRef(initialLocation)
  useEffect(() => {
    if (initialLocation && initialLocation !== firstTarget.current) {
      firstTarget.current = initialLocation
      handle.current?.goTo(initialLocation)
    }
  }, [initialLocation])
  const goTo = (location: string): void => handle.current?.goTo(location)

  const zoom = (dir: 1 | -1): void =>
    updatePrefs({ pdfZoom: zoomStep(prefs.pdfZoom, dir, handle.current?.getScale?.() ?? 1) })

  const colors = PAGE_COLORS[prefs.theme]
  const commonProps = {
    session,
    prefs,
    initialLocation,
    onReady,
    onPosition,
    onError: setError,
    onKey,
    handleRef: handle,
    annotations,
    onSelection,
    onAnnotationClick
  }

  return (
    <div className="flex h-full flex-col" style={{ background: colors.bg }}>
      {!focusMode && (
        <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
          <Link
            to="/library"
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-sunken hover:text-text"
          >
            <ArrowLeft size={16} aria-hidden /> Library
          </Link>
          <IconButton
            label="Contents"
            active={panel === 'toc'}
            onClick={() => setPanel(panel === 'toc' ? null : 'toc')}
          >
            <ListTree size={18} />
          </IconButton>
          {book.format === 'pdf' && (
            <IconButton
              label="Page thumbnails"
              active={panel === 'pages'}
              onClick={() => setPanel(panel === 'pages' ? null : 'pages')}
            >
              <GalleryVerticalEnd size={18} />
            </IconButton>
          )}
          <div className="min-w-0 flex-1 px-3 text-center">
            <h1 className="truncate text-sm font-medium">{book.title}</h1>
            {session.versions.length > 0 && (
              <select
                aria-label="Version"
                value={version?.id ?? ''}
                onChange={(e) =>
                  navigate(
                    e.target.value
                      ? `/reader/${book.id}?version=${e.target.value}`
                      : `/reader/${book.id}`
                  )
                }
                className="mx-auto mt-0.5 block max-w-64 truncate rounded bg-transparent text-xs text-accent hover:bg-sunken"
              >
                <option value="">Original</option>
                {session.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            )}
            <p className="truncate text-xs text-muted" aria-live="polite">
              {position?.label ?? ' '}
            </p>
          </div>
          {book.format === 'pdf' && (
            <div className="flex items-center" role="group" aria-label="Zoom">
              <IconButton label="Zoom out" onClick={() => zoom(-1)}>
                <Minus size={16} />
              </IconButton>
              <select
                aria-label="Zoom level"
                value={typeof prefs.pdfZoom === 'number' ? 'custom' : prefs.pdfZoom}
                onChange={(e) => updatePrefs({ pdfZoom: e.target.value as ReaderPrefs['pdfZoom'] })}
                className="rounded-md bg-transparent px-1 py-1 text-xs text-muted hover:bg-sunken"
              >
                {typeof prefs.pdfZoom === 'number' && (
                  <option value="custom">{Math.round(prefs.pdfZoom * 100)}%</option>
                )}
                <option value="page-width">Fit width</option>
                <option value="page-fit">Fit page</option>
                <option value="auto">Auto</option>
              </select>
              <IconButton label="Zoom in" onClick={() => zoom(1)}>
                <Plus size={16} />
              </IconButton>
            </div>
          )}
          <IconButton
            label="Search in book (Ctrl+F)"
            active={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={18} />
          </IconButton>
          <IconButton
            label={bookmarkId ? 'Remove bookmark' : 'Bookmark this page'}
            active={!!bookmarkId}
            onClick={() => void toggleBookmark()}
          >
            {bookmarkId ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
          </IconButton>
          <IconButton
            label="Notes and highlights"
            active={notesOpen}
            onClick={() => setNotesOpen(!notesOpen)}
          >
            <NotebookPen size={18} />
          </IconButton>
          <div className="relative" data-display-toggle>
            <IconButton
              label="Display settings"
              active={displayOpen}
              onClick={() => setDisplayOpen(!displayOpen)}
            >
              <Type size={18} />
            </IconButton>
            {displayOpen && (
              <DisplayPopover
                prefs={prefs}
                format={book.format}
                onChange={updatePrefs}
                onClose={() => setDisplayOpen(false)}
              />
            )}
          </div>
          {version && <ExportMenu versionId={version.id} />}
          <IconButton label="Open in AI Studio" onClick={() => navigate(`/ai?book=${book.id}`)}>
            <Sparkles size={18} />
          </IconButton>
          <IconButton label="Focus mode (F11)" onClick={() => setFocusMode(true)}>
            <Maximize2 size={18} />
          </IconButton>
        </header>
      )}

      <div className="flex min-h-0 flex-1">
        {panel === 'toc' && !focusMode && (
          <nav
            aria-label="Contents"
            className="w-72 shrink-0 overflow-y-auto border-r border-border bg-surface p-3"
          >
            {toc === null ? (
              <p className="p-2 text-sm text-muted">Loading…</p>
            ) : toc.length === 0 ? (
              <p className="p-2 text-sm text-muted">This book has no table of contents.</p>
            ) : (
              <TocTree items={toc} onSelect={goTo} />
            )}
          </nav>
        )}

        <main className="relative min-w-0 flex-1">
          {error ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <p className="font-serif text-xl text-text">This book couldn’t be opened</p>
                <p className="mt-2 max-w-md text-sm text-muted">{error}</p>
              </div>
            </div>
          ) : book.format === 'pdf' ? (
            <PdfReader {...commonProps} showThumbnails={panel === 'pages' && !focusMode} />
          ) : book.format === 'epub' ? (
            <div className="flex h-full">
              {prefs.flow === 'paginated' && (
                <button
                  aria-label="Previous page"
                  onClick={() => handle.current?.prev()}
                  className="w-12 shrink-0 text-center opacity-40 hover:opacity-100"
                  style={{ color: colors.muted }}
                >
                  <ChevronLeft className="mx-auto" />
                </button>
              )}
              <div className="min-w-0 flex-1 py-6">
                <EpubReader {...commonProps} />
              </div>
              {prefs.flow === 'paginated' && (
                <button
                  aria-label="Next page"
                  onClick={() => handle.current?.next()}
                  className="w-12 shrink-0 text-center opacity-40 hover:opacity-100"
                  style={{ color: colors.muted }}
                >
                  <ChevronRight className="mx-auto" />
                </button>
              )}
            </div>
          ) : (
            <HtmlReader {...commonProps} />
          )}
          {focusMode && (
            <button
              onClick={() => setFocusMode(false)}
              aria-label="Exit focus mode"
              className="absolute top-3 right-3 rounded-md p-2 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
              style={{ color: colors.muted }}
            >
              <Minimize2 size={18} />
            </button>
          )}
        </main>

        {searchOpen && !focusMode && (
          <SearchPanel handle={handle} onClose={() => setSearchOpen(false)} />
        )}
        {notesOpen && !focusMode && (
          <NotesPanel
            bookId={book.id}
            format={book.format}
            annotations={annotations}
            onOpen={(a) => handle.current?.goTo(a.location)}
            onUpdate={(id, patch) => void update(id, patch)}
            onDelete={(id) => void remove(id)}
            onClose={() => setNotesOpen(false)}
          />
        )}
        {pop && (
          <HighlightPopover
            key={
              pop.mode === 'new'
                ? `new-${pop.sel.location}`
                : `edit-${pop.id}-${pop.editing ? 1 : 0}`
            }
            state={pop}
            annotation={
              pop.mode === 'edit' ? (annotations.find((a) => a.id === pop.id) ?? null) : null
            }
            onCreate={(c, n) => void createHighlight(c, n)}
            onAsk={
              pop.mode === 'new'
                ? () => {
                    setAsking(pop.sel)
                    setPop(null)
                  }
                : undefined
            }
            onUpdate={(patch) => pop.mode === 'edit' && void update(pop.id, patch)}
            onDelete={() => {
              if (pop.mode === 'edit') void remove(pop.id)
              setPop(null)
            }}
            onClose={() => setPop(null)}
          />
        )}
      </div>

      {asking && (
        <AskAiPanel
          bookId={book.id}
          sel={asking}
          onClose={() => setAsking(null)}
          onSaveNote={(answer) => {
            void create({
              type: 'highlight',
              anchor: asking.anchor,
              location: asking.location,
              chapter: asking.chapter,
              sortKey: asking.sortKey,
              text: asking.text,
              color: 'blue',
              note: answer
            }).then((a) => {
              if (a) toast.success('Saved as a note on this passage.')
            })
            asking.clear()
            setAsking(null)
          }}
        />
      )}
      <div className="h-1 shrink-0" style={{ background: colors.bg }} aria-hidden>
        <div
          className="h-full bg-accent/60 transition-[width]"
          style={{ width: `${Math.round((position?.progress ?? 0) * 100)}%` }}
        />
      </div>
    </div>
  )
}
