import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import {
  BookOpen,
  Compass,
  Folder,
  Library,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { Collection } from '../../../shared/ipc'
import { cn } from '../lib/cn'
import { JobsIndicator } from './JobsIndicator'
import { Menu } from './Menu'
import { ConfirmModal } from './Modal'
import { BOOK_DRAG_TYPE } from './BookGrid'
import { useLibrary } from '../stores/library'
import { toast } from '../stores/toasts'

const NAV: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/library', label: 'Library', icon: Library },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/reader', label: 'Reader', icon: BookOpen },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/ai', label: 'AI Studio', icon: Sparkles }
]

const itemClass = (active: boolean): string =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    active ? 'bg-accent-soft text-accent font-medium' : 'text-muted hover:bg-sunken hover:text-text'
  )

function Item({
  to,
  label,
  icon: Icon,
  active
}: {
  to: string
  label: string
  icon: LucideIcon
  active?: boolean
}): React.JSX.Element {
  return (
    <NavLink to={to} className={({ isActive }) => itemClass(active ?? isActive)}>
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      {label}
    </NavLink>
  )
}

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function NameInput({
  initial,
  onSubmit,
  onCancel,
  label
}: {
  initial: string
  onSubmit: (name: string) => void
  onCancel: () => void
  label: string
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <input
      autoFocus
      aria-label={label}
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() =>
        value.trim() && value.trim() !== initial ? onSubmit(value.trim()) : onCancel()
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') onCancel()
      }}
      className="mx-1 rounded-md border border-accent bg-surface px-2 py-1.5 text-sm outline-none"
    />
  )
}

function CollectionItem({
  c,
  active,
  onMenu
}: {
  c: Collection
  active: boolean
  onMenu: (c: Collection, at: { x: number; y: number }) => void
}): React.JSX.Element {
  const [dropping, setDropping] = useState(false)
  const accepts = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(BOOK_DRAG_TYPE)
  return (
    <div
      className={cn('group relative rounded-lg', dropping && 'ring-2 ring-accent')}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const bookId = e.dataTransfer.getData(BOOK_DRAG_TYPE)
        if (!bookId) return
        e.preventDefault()
        window.api.collections
          .addBook(c.id, bookId)
          .then(() => toast.success(`Added to ${c.name}.`))
          .catch((x) => toast.error(err(x)))
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(c, { x: e.clientX, y: e.clientY })
      }}
    >
      <Link to={`/library?collection=${c.id}`} className={cn(itemClass(active), 'pr-8')}>
        <Folder size={16} strokeWidth={1.75} aria-hidden />
        <span className="flex-1 truncate">{c.name}</span>
        <span className="text-xs text-muted tabular-nums group-hover:invisible">{c.bookCount}</span>
      </Link>
      <button
        aria-label={`Options for ${c.name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(c, { x: r.left, y: r.bottom + 4 })
        }}
        className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded p-1 text-muted group-hover:block hover:text-text focus:block"
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  )
}

function Collections(): React.JSX.Element {
  const collections = useLibrary((s) => s.collections)
  const location = useLocation()
  const navigate = useNavigate()
  const activeId =
    location.pathname === '/library' ? new URLSearchParams(location.search).get('collection') : null
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ c: Collection; x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<Collection | null>(null)

  return (
    <section aria-label="Collections" className="mt-6 flex min-h-0 flex-col">
      <div className="mb-1 flex items-center justify-between px-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Collections</h2>
        <button
          aria-label="New collection"
          onClick={() => setCreating(true)}
          className="rounded p-1 text-muted hover:bg-sunken hover:text-text"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
        {collections.map((c) =>
          renaming === c.id ? (
            <NameInput
              key={c.id}
              label="Collection name"
              initial={c.name}
              onCancel={() => setRenaming(null)}
              onSubmit={(name) => {
                setRenaming(null)
                window.api.collections.rename(c.id, name).catch((x) => toast.error(err(x)))
              }}
            />
          ) : (
            <CollectionItem
              key={c.id}
              c={c}
              active={activeId === c.id}
              onMenu={(c, at) => setMenu({ c, ...at })}
            />
          )
        )}
        {creating && (
          <NameInput
            label="New collection name"
            initial=""
            onCancel={() => setCreating(false)}
            onSubmit={(name) => {
              setCreating(false)
              window.api.collections
                .create(name)
                .then((c) => navigate(`/library?collection=${c.id}`))
                .catch((x) => toast.error(err(x)))
            }}
          />
        )}
        {collections.length === 0 && !creating && (
          <p className="px-3 py-1 text-xs leading-relaxed text-muted">
            Group books into shelves like “To read” or “Course notes”.
          </p>
        )}
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label={`Options for ${menu.c.name}`}
          onClose={() => setMenu(null)}
          entries={[
            { kind: 'item', label: 'Rename', icon: Pencil, onSelect: () => setRenaming(menu.c.id) },
            {
              kind: 'item',
              label: 'Delete…',
              icon: Trash2,
              danger: true,
              onSelect: () => setDeleting(menu.c)
            }
          ]}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete collection?"
          danger
          confirmLabel="Delete collection"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const c = deleting
            window.api.collections
              .delete(c.id)
              .then(() => activeId === c.id && navigate('/library'))
              .catch((x) => toast.error(err(x)))
          }}
          message={
            <>
              “<span className="text-text">{deleting.name}</span>” will be deleted. The books in it
              stay in your library.
            </>
          }
        />
      )}
    </section>
  )
}

export function Sidebar(): React.JSX.Element {
  const location = useLocation()
  const inCollection =
    location.pathname === '/library' && new URLSearchParams(location.search).has('collection')
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-5">
      <div className="mb-6 px-3">
        <span className="font-serif text-xl tracking-tight">Ur Library</span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map((n) => (
          <Item
            key={n.to}
            {...n}
            active={
              n.to === '/library' ? location.pathname === '/library' && !inCollection : undefined
            }
          />
        ))}
      </nav>
      <Collections />
      <div className="mt-auto flex flex-col gap-2 pt-4">
        <JobsIndicator />
        <Item to="/settings" label="Settings" icon={Settings} />
      </div>
    </aside>
  )
}
