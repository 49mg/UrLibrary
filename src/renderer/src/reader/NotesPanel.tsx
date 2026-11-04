import { useState } from 'react'
import { Bookmark, Download, FileDown, MessageSquare, Trash2, X } from 'lucide-react'
import {
  HIGHLIGHT_COLORS,
  type Annotation,
  type BookFormat,
  type HighlightColor
} from '../../../shared/ipc'
import { HIGHLIGHT_HEX } from './types'
import { Notebook } from './Notebook'
import { locationLabel } from '../lib/format'
import { toast } from '../stores/toasts'
import { cn } from '../lib/cn'

type Filter = 'all' | 'highlights' | 'notes' | 'bookmarks'

function NoteEditor({
  initial,
  onSave,
  onCancel
}: {
  initial: string
  onSave: (v: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [v, setV] = useState(initial)
  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        aria-label="Note"
        rows={3}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(v)
          if (e.key === 'Escape') onCancel()
          e.stopPropagation()
        }}
        className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      <div className="mt-1 flex justify-end gap-1">
        <button onClick={onCancel} className="rounded px-2 py-1 text-xs text-muted hover:bg-sunken">
          Cancel
        </button>
        <button
          onClick={() => onSave(v)}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-text"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function Item({
  a,
  onOpen,
  onUpdate,
  onDelete
}: {
  a: Annotation
  onOpen: () => void
  onUpdate: (patch: { note?: string | null }) => void
  onDelete: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const where = [a.chapter, locationLabel(a.location)].filter(Boolean).join(' · ')
  return (
    <li className="group relative rounded-lg border border-border bg-bg/40 hover:bg-sunken/60">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className="flex cursor-pointer gap-3 px-3 py-2.5 text-left"
      >
        {a.type === 'bookmark' ? (
          <Bookmark size={16} className="mt-0.5 shrink-0 text-accent" aria-label="Bookmark" />
        ) : (
          <span
            className="w-1 shrink-0 rounded-full"
            style={{ background: HIGHLIGHT_HEX[a.color ?? 'yellow'] }}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          {where && <div className="mb-0.5 truncate text-xs text-muted">{where}</div>}
          {a.type === 'bookmark' ? (
            <div className="text-sm">Bookmark · {Math.round(a.sortKey * 100)}%</div>
          ) : (
            <p className="line-clamp-4 font-serif text-[14px] leading-relaxed">{a.text}</p>
          )}
          {a.note && !editing && (
            <p className="mt-1.5 flex gap-1.5 text-sm whitespace-pre-wrap text-text/90">
              <MessageSquare size={13} className="mt-1 shrink-0 text-muted" aria-hidden />
              {a.note}
            </p>
          )}
          {editing && (
            <NoteEditor
              initial={a.note ?? ''}
              onCancel={() => setEditing(false)}
              onSave={(v) => {
                onUpdate({ note: v.trim() || null })
                setEditing(false)
              }}
            />
          )}
        </div>
      </div>
      {!editing && (
        <div className="absolute top-1.5 right-1.5 hidden gap-0.5 rounded-md bg-surface shadow-sm group-focus-within:flex group-hover:flex">
          {a.type === 'highlight' && (
            <button
              aria-label={a.note ? 'Edit note' : 'Add note'}
              title={a.note ? 'Edit note' : 'Add note'}
              onClick={() => setEditing(true)}
              className="rounded p-1.5 text-muted hover:text-text"
            >
              <MessageSquare size={14} />
            </button>
          )}
          <button
            aria-label="Delete"
            title="Delete"
            onClick={onDelete}
            className="rounded p-1.5 text-muted hover:text-danger"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </li>
  )
}

export function NotesPanel({
  bookId,
  format,
  annotations,
  onOpen,
  onUpdate,
  onDelete,
  onClose
}: {
  bookId: string
  format: BookFormat
  annotations: Annotation[]
  onOpen: (a: Annotation) => void
  onUpdate: (id: string, patch: { note?: string | null }) => void
  onDelete: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'marks' | 'notebook'>('marks')
  const [filter, setFilter] = useState<Filter>('all')
  const [color, setColor] = useState<HighlightColor | null>(null)

  const shown = annotations.filter((a) => {
    if (filter === 'highlights' && a.type !== 'highlight') return false
    if (filter === 'notes' && !a.note) return false
    if (filter === 'bookmarks' && a.type !== 'bookmark') return false
    if (color && a.color !== color) return false
    return true
  })

  const exportAs = async (kind: 'markdown' | 'pdf'): Promise<void> => {
    try {
      const r =
        kind === 'markdown'
          ? await window.api.exports.markdown(bookId)
          : await window.api.exports.annotatedPdf(bookId)
      if (r) toast.success(`Exported to ${r.path}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <aside
      aria-label="Notes"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <div role="tablist" className="flex flex-1 gap-1">
          {(
            [
              ['marks', `Highlights${annotations.length ? ` (${annotations.length})` : ''}`],
              ['notebook', 'Notebook']
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm',
                tab === t ? 'bg-sunken font-medium' : 'text-muted hover:text-text'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          aria-label="Export notes as Markdown"
          title="Export notes as Markdown"
          onClick={() => void exportAs('markdown')}
          className="rounded p-1.5 text-muted hover:bg-sunken hover:text-text"
        >
          <Download size={16} />
        </button>
        {format === 'pdf' && (
          <button
            aria-label="Export PDF with highlights"
            title="Export PDF with highlights"
            onClick={() => void exportAs('pdf')}
            className="rounded p-1.5 text-muted hover:bg-sunken hover:text-text"
          >
            <FileDown size={16} />
          </button>
        )}
        <button
          aria-label="Close notes"
          onClick={onClose}
          className="rounded p-1.5 text-muted hover:text-text"
        >
          <X size={16} />
        </button>
      </div>

      {tab === 'notebook' ? (
        <Notebook bookId={bookId} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            <select
              aria-label="Show"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              <option value="all">Everything</option>
              <option value="highlights">Highlights</option>
              <option value="notes">With notes</option>
              <option value="bookmarks">Bookmarks</option>
            </select>
            <div className="ml-auto flex gap-1" role="group" aria-label="Filter by color">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`Only ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(color === c ? null : c)}
                  className={cn(
                    'size-4 rounded-full ring-offset-1 ring-offset-surface',
                    color === c && 'ring-2 ring-text'
                  )}
                  style={{ background: HIGHLIGHT_HEX[c] }}
                />
              ))}
            </div>
          </div>
          {annotations.length === 0 ? (
            <p className="px-4 py-6 text-sm leading-relaxed text-muted">
              Select text in the book to highlight it or add a note. Use the bookmark button to mark
              a page.
            </p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Nothing matches this filter.</p>
          ) : (
            <ol
              className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4"
              aria-label="Highlights and bookmarks"
            >
              {shown.map((a) => (
                <Item
                  key={a.id}
                  a={a}
                  onOpen={() => onOpen(a)}
                  onUpdate={(p) => onUpdate(a.id, p)}
                  onDelete={() => onDelete(a.id)}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </aside>
  )
}
