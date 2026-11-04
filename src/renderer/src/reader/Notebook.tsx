import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import { Bold, Heading2, Italic, List, ListOrdered, Quote } from 'lucide-react'
import { cn } from '../lib/cn'
import { toast } from '../stores/toasts'

const SAVE_DELAY = 800

/** Formatting button; mousedown is prevented so the editor keeps its selection. */
function ToolButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'rounded p-1.5',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-text'
      )}
    >
      {children}
    </button>
  )
}

/** Free-form notes for one book, edited as rich text and stored as Markdown. */
export function Notebook({ bookId }: { bookId: string }): React.JSX.Element {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    let cancelled = false
    window.api.notebook
      .get(bookId)
      .then((n) => !cancelled && setLoaded(n.content))
      .catch((e: Error) => toast.error(`Couldn’t load notebook: ${e.message}`))
    return () => {
      cancelled = true
    }
  }, [bookId])

  if (loaded === null) return <p className="p-4 text-sm text-muted">Loading…</p>
  return <NotebookEditor bookId={bookId} initial={loaded} status={status} setStatus={setStatus} />
}

function NotebookEditor({
  bookId,
  initial,
  status,
  setStatus
}: {
  bookId: string
  initial: string
  status: 'idle' | 'saving' | 'saved'
  setStatus: (s: 'idle' | 'saving' | 'saved') => void
}): React.JSX.Element {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)

  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const content = pending.current
    pending.current = null
    if (content === null) return
    setStatus('saving')
    window.api.notebook
      .save(bookId, content)
      .then(() => setStatus('saved'))
      .catch((e: Error) => {
        setStatus('idle')
        toast.error(`Couldn’t save notebook: ${e.message}`)
      })
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Markdown,
      Placeholder.configure({
        placeholder: 'Your thoughts on this book: summaries, questions, ideas…'
      })
    ],
    content: initial,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'sl-prose sl-notebook outline-none min-h-60', 'aria-label': 'Notebook' }
    },
    onUpdate: ({ editor }) => {
      pending.current = editor.getMarkdown()
      setStatus('idle')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY)
    }
  })

  // Save anything pending when the panel closes or the book changes.
  useEffect(() => () => flushRef.current(), [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor && (
        <div
          className="flex items-center gap-0.5 border-b border-border px-2 py-1"
          role="toolbar"
          aria-label="Formatting"
        >
          <ToolButton
            label="Bold"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </ToolButton>
          <ToolButton
            label="Italic"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </ToolButton>
          <ToolButton
            label="Heading"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={15} />
          </ToolButton>
          <ToolButton
            label="Bullet list"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={15} />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={15} />
          </ToolButton>
          <ToolButton
            label="Quote"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={15} />
          </ToolButton>
          <span className="ml-auto pr-1 text-xs text-muted" role="status">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
