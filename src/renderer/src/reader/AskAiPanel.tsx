import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Loader2, MessageSquarePlus, Sparkles, X } from 'lucide-react'
import type { AskAction } from '../../../shared/ipc'
import type { PendingSelection } from './types'
import { Markdown } from '../components/Markdown'
import { useAi } from '../stores/ai'
import { useLatest } from '../lib/useLatest'
import { cn } from '../lib/cn'

const ACTIONS: Array<[AskAction, string]> = [
  ['explain', 'Explain'],
  ['define', 'Define'],
  ['translate', 'Translate'],
  ['simplify', 'Simplify']
]

/** Asks Claude about the selected passage; the answer streams in and can be saved as a note. */
export function AskAiPanel({
  bookId,
  sel,
  onSaveNote,
  onClose
}: {
  bookId: string
  sel: PendingSelection
  onSaveNote: (answer: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [action, setAction] = useState<AskAction | null>(null)
  const [final, setFinal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamed = useAi((s) => (requestId ? s.answers[requestId] : undefined))
  const [pos, setPos] = useState({ left: sel.rect.left, top: sel.rect.top + sel.rect.height + 10 })
  const closeRef = useLatest(onClose)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const below = sel.rect.top + sel.rect.height + 10
    const top =
      below + height < window.innerHeight - 8 ? below : Math.max(8, sel.rect.top - height - 10)
    setPos({ left: Math.max(8, Math.min(sel.rect.left, window.innerWidth - width - 8)), top })
  }, [sel.rect, streamed, final])

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [closeRef])

  // Stop generating when a new question replaces this one or the panel closes mid-answer.
  useEffect(() => {
    if (!requestId) return
    return () => void window.api.ai.askCancel(requestId).catch(() => undefined)
  }, [requestId])

  const ask = async (a: AskAction): Promise<void> => {
    const id = crypto.randomUUID()
    setAction(a)
    setRequestId(id)
    setFinal(null)
    setError(null)
    try {
      const r = await window.api.ai.ask({
        requestId: id,
        bookId,
        text: sel.text,
        action: a,
        context: sel.chapter ?? undefined
      })
      setFinal(r.text)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'Cancelled') setError(msg)
    }
  }

  const answer = final ?? streamed ?? ''
  const busy = !!requestId && final === null && !error
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Ask AI about this passage"
      style={pos}
      className="fixed z-50 flex max-h-[60vh] w-96 flex-col rounded-xl border border-border bg-surface shadow-xl"
    >
      <div className="flex items-center gap-1 border-b border-border p-2">
        <Sparkles size={15} className="mx-1 text-accent" aria-hidden />
        <div role="group" aria-label="Question" className="flex flex-1 gap-1">
          {ACTIONS.map(([a, label]) => (
            <button
              key={a}
              aria-pressed={action === a}
              disabled={busy}
              onClick={() => void ask(a)}
              className={cn(
                'rounded-md px-2 py-1 text-sm disabled:opacity-50',
                action === a ? 'bg-accent-soft font-medium text-accent' : 'hover:bg-sunken'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-muted hover:text-text"
        >
          <X size={15} />
        </button>
      </div>
      <div
        className="min-h-16 overflow-y-auto px-4 py-3 text-sm leading-relaxed"
        aria-live="polite"
      >
        {!requestId && (
          <p className="text-muted">
            Pick a question about “{sel.text.slice(0, 80)}
            {sel.text.length > 80 ? '…' : ''}”.
          </p>
        )}
        {busy && !answer && (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Thinking…
          </p>
        )}
        {answer && <Markdown text={answer} />}
        {error && <p className="text-danger">{error}</p>}
      </div>
      {final && (
        <div className="flex justify-end gap-2 border-t border-border p-2">
          <button
            onClick={() => void navigator.clipboard.writeText(final)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken hover:text-text"
          >
            <Copy size={14} aria-hidden /> Copy
          </button>
          <button
            onClick={() => onSaveNote(final)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-text"
          >
            <MessageSquarePlus size={14} aria-hidden /> Save as note
          </button>
        </div>
      )}
    </div>
  )
}
