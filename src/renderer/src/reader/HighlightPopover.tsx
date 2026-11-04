import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react'
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor } from '../../../shared/ipc'
import { HIGHLIGHT_HEX, type PendingSelection } from './types'
import { cn } from '../lib/cn'

const COLOR_NAMES: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple'
}

export type PopoverState =
  | { mode: 'new'; sel: PendingSelection }
  | { mode: 'edit'; id: string; rect: PendingSelection['rect']; editing?: boolean }

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Defer so the mouseup that opened us doesn't immediately close us.
    const t = setTimeout(() => window.addEventListener('mousedown', down), 0)
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [ref, onClose])
}

/**
 * Floating toolbar over a selection (pick a color, add a note, copy) or over an existing highlight
 * (change color, edit note, delete).
 */
export function HighlightPopover({
  state,
  annotation,
  onCreate,
  onAsk,
  onUpdate,
  onDelete,
  onClose
}: {
  state: PopoverState
  annotation: Annotation | null
  onCreate: (color: HighlightColor, withNote: boolean) => void
  /** Open "Ask AI" for the current selection (new selections only). */
  onAsk?: () => void
  onUpdate: (patch: { note?: string | null; color?: HighlightColor }) => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const rect = state.mode === 'new' ? state.sel.rect : state.rect
  const [pos, setPos] = useState({ left: rect.left, top: rect.top })
  const [editing, setEditing] = useState(state.mode === 'edit' && !!state.editing)
  const [draft, setDraft] = useState(annotation?.note ?? '')
  useOutsideClose(ref, onClose)

  // Above the selection if there's room, otherwise below; always inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const above = rect.top - height - 10
    const top =
      above > 8 ? above : Math.min(rect.top + rect.height + 10, window.innerHeight - height - 8)
    const left = Math.max(
      8,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)
    )
    setPos({ left, top })
  }, [rect.left, rect.top, rect.width, rect.height, editing])

  const saveNote = (): void => {
    onUpdate({ note: draft.trim() || null })
    setEditing(false)
    onClose()
  }

  const current = annotation?.color ?? null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={state.mode === 'new' ? 'Highlight selection' : 'Edit highlight'}
      style={pos}
      className="fixed z-50 rounded-xl border border-border bg-surface p-1.5 shadow-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`${state.mode === 'new' ? 'Highlight' : 'Change to'} ${COLOR_NAMES[c]}`}
            aria-pressed={current === c}
            onClick={() => (state.mode === 'new' ? onCreate(c, false) : onUpdate({ color: c }))}
            className={cn(
              'm-0.5 size-6 rounded-full ring-offset-2 ring-offset-surface hover:scale-110',
              current === c && 'ring-2 ring-text'
            )}
            style={{ background: HIGHLIGHT_HEX[c] }}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button
          onClick={() => (state.mode === 'new' ? onCreate('yellow', true) : setEditing(true))}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-sunken"
        >
          <MessageSquarePlus size={15} aria-hidden /> {annotation?.note ? 'Edit note' : 'Note'}
        </button>
        {state.mode === 'new' && onAsk && (
          <button
            onClick={onAsk}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-sunken"
          >
            <Sparkles size={15} className="text-accent" aria-hidden /> Ask AI
          </button>
        )}
        {state.mode === 'new' ? (
          <button
            aria-label="Copy"
            title="Copy"
            onClick={() => {
              void navigator.clipboard.writeText(state.sel.text)
              onClose()
            }}
            className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-text"
          >
            <Copy size={15} />
          </button>
        ) : (
          <button
            aria-label="Delete highlight"
            title="Delete highlight"
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {state.mode === 'edit' && annotation?.note && !editing && (
        <p className="max-w-80 px-2 pt-2 pb-1 text-sm leading-relaxed whitespace-pre-wrap">
          {annotation.note}
        </p>
      )}
      {editing && (
        <div className="w-80 p-1 pt-2">
          <textarea
            autoFocus
            aria-label="Note"
            rows={4}
            value={draft}
            placeholder="Write a note… (Ctrl+Enter to save)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote()
              e.stopPropagation()
            }}
            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1 text-sm text-muted hover:bg-sunken"
            >
              Cancel
            </button>
            <button
              onClick={saveNote}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-text"
            >
              Save note
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
