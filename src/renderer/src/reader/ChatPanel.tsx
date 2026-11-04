import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { ArrowUp, Loader2, MessagesSquare, Square, Trash2, X } from 'lucide-react'
import type { ChatInfo, ChatMessage } from '../../../shared/ipc'
import { useAi, formatUsd } from '../stores/ai'
import { locationLabel } from '../lib/format'
import { toast } from '../stores/toasts'
import { cn } from '../lib/cn'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

/** Markdown with [[n]] citation markers turned into small buttons (after sanitizing; n is digits only). */
function AnswerText({
  text,
  onCite
}: {
  text: string
  onCite: (n: number) => void
}): React.JSX.Element {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(md.render(text)).replace(
        /\[\[(\d{1,3})\]\]/g,
        '<button type="button" class="sl-cite" data-cite="$1" aria-label="Source $1">$1</button>'
      ),
    [text]
  )
  return (
    <div
      className="sl-prose sl-chat"
      onClick={(e) => {
        const n = (e.target as HTMLElement).closest<HTMLElement>('[data-cite]')?.dataset.cite
        if (n) onCite(Number(n))
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function Sources({
  message,
  onOpen
}: {
  message: ChatMessage
  onOpen: (location: string) => void
}): React.JSX.Element | null {
  if (!message.citations.length) return null
  return (
    <ol aria-label="Sources" className="mt-2 space-y-1">
      {message.citations.map((c) => (
        <li key={c.n}>
          <button
            onClick={() => onOpen(c.location)}
            title={c.quote}
            className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-sunken"
          >
            <span className="sl-cite shrink-0">{c.n}</span>
            <span className="min-w-0">
              <span className="font-medium text-text">
                {[c.chapter, locationLabel(c.location)].filter(Boolean).join(' · ') || 'Passage'}
              </span>
              <span className="line-clamp-2 text-muted">“{c.quote}”</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/** Ask questions about the open book; answers cite passages that open in the reader. */
export function ChatPanel({
  bookId,
  location,
  onOpen,
  onClose
}: {
  bookId: string
  /** Where the reader is now, so "this chapter" questions work. */
  location: string | null
  onOpen: (location: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ requestId: string; question: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamed = useAi((s) => (pending ? s.answers[pending.requestId] : undefined))
  const scroller = useRef<HTMLDivElement>(null)
  const [hasKey, setHasKey] = useState(true)

  useEffect(() => {
    let live = true
    window.api.apiKey.status().then(
      (s) => live && setHasKey(s.isSet),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    window.api.chat.history(bookId).then(
      (m) => live && setMessages(m),
      () => undefined
    )
    window.api.chat.info(bookId).then(
      (i) => live && setInfo(i),
      (e: Error) => live && setError(e.message)
    )
    return () => {
      live = false
    }
  }, [bookId])

  // Stop generating if the panel closes mid-answer.
  useEffect(() => {
    if (!pending) return
    const id = pending.requestId
    return () => void window.api.chat.cancel(id).catch(() => undefined)
  }, [pending])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamed, pending])

  const ask = async (): Promise<void> => {
    const question = draft.trim()
    if (!question || pending) return
    const requestId = crypto.randomUUID()
    setDraft('')
    setError(null)
    setPending({ requestId, question })
    try {
      const r = await window.api.chat.ask({
        requestId,
        bookId,
        question,
        location: location ?? undefined
      })
      setMessages((m) => [...m, r.question, r.answer])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'Cancelled') setError(msg)
      setDraft(question)
    } finally {
      setPending(null)
    }
  }

  const clear = async (): Promise<void> => {
    await window.api.chat.clear(bookId)
    setMessages([])
    toast.info('Chat cleared')
  }

  const cite = useCallback(
    (m: ChatMessage, n: number) => {
      const c = m.citations.find((x) => x.n === n)
      if (c) onOpen(c.location)
    },
    [onOpen]
  )

  return (
    <aside
      aria-label="Chat about this book"
      className="flex w-96 shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <MessagesSquare size={16} className="text-accent" aria-hidden />
        <h2 className="flex-1 text-sm font-medium">Ask about this book</h2>
        {messages.length > 0 && (
          <button
            onClick={() => void clear()}
            aria-label="Clear chat"
            title="Clear chat"
            className="rounded p-1 text-muted hover:text-text"
          >
            <Trash2 size={15} />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="rounded p-1 text-muted hover:text-text"
        >
          <X size={15} />
        </button>
      </div>

      <div
        ref={scroller}
        className="flex-1 space-y-4 overflow-y-auto px-3 py-3 text-sm"
        aria-live="polite"
      >
        {!hasKey && (
          <p className="rounded-lg bg-sunken p-3 text-muted">
            Chat uses your Anthropic API key.{' '}
            <Link to="/settings" className="text-accent underline">
              Add it in Settings
            </Link>
            .
          </p>
        )}
        {hasKey && messages.length === 0 && !pending && (
          <div className="space-y-2 text-muted">
            <p>Ask anything about this book. Answers point to the passages they come from.</p>
            {info && (
              <p className="text-xs">
                {info.mode === 'full'
                  ? `The whole book is read for each question. First question about ${formatUsd(info.firstQuestionUsd)}, follow-ups about ${formatUsd(info.followUpUsd)}.`
                  : `This book is long, so the most relevant passages are found for each question. About ${formatUsd(info.firstQuestionUsd)} per question.`}
              </p>
            )}
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id}>
              {m.freshContext && messages[0]?.id !== m.id && (
                <p className="mb-3 text-center text-xs text-muted">New conversation</p>
              )}
              <p className="ml-8 rounded-xl bg-accent-soft px-3 py-2 whitespace-pre-wrap">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={m.id} role="article" aria-label="Answer">
              <AnswerText text={m.content} onCite={(n) => cite(m, n)} />
              <Sources message={m} onOpen={onOpen} />
            </div>
          )
        )}
        {pending && (
          <>
            <p className="ml-8 rounded-xl bg-accent-soft px-3 py-2 whitespace-pre-wrap">
              {pending.question}
            </p>
            {streamed ? (
              <AnswerText text={streamed} onCite={() => undefined} />
            ) : (
              <p className="flex items-center gap-2 text-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Reading the book…
              </p>
            )}
          </>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>

      <form
        className="border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border bg-bg px-2 py-1.5 focus-within:border-accent">
          <textarea
            aria-label="Question"
            rows={2}
            value={draft}
            disabled={!hasKey}
            placeholder="Who is…? Why does…? Summarize this chapter…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask()
              }
            }}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none focus-visible:outline-none"
          />
          {pending ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => void window.api.chat.cancel(pending.requestId)}
              className="rounded-md bg-sunken p-1.5 text-text"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!hasKey || !draft.trim()}
              className={cn('rounded-md bg-accent p-1.5 text-accent-text disabled:opacity-40')}
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </form>
    </aside>
  )
}
