import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  BookOpen,
  Download,
  CheckCircle2,
  Circle,
  CircleDot,
  FolderOpen,
  FolderPlus,
  FolderMinus,
  Pencil,
  RefreshCw,
  ScanText,
  Trash2
} from 'lucide-react'
import type { BookSummary, ReadingStatus } from '../../../shared/ipc'
import { Menu, type MenuEntry } from './Menu'
import { DeleteBookModal, EditBookModal, OcrModal } from './BookModals'
import { useLibrary } from '../stores/library'
import { toast } from '../stores/toasts'
import { useJobs, activeJobs } from '../stores/jobs'

type ModalState = { kind: 'edit' | 'delete' | 'ocr'; book: BookSummary } | null

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Everything you can do with a book from the library (context menu, ⋯ button).
 * Returns an opener plus the elements (menu and dialogs) to render once.
 */
export function useBookActions(currentCollectionId?: string | null): {
  open: (book: BookSummary, at: { x: number; y: number }) => void
  edit: (book: BookSummary) => void
  node: React.ReactNode
} {
  const navigate = useNavigate()
  const collections = useLibrary((s) => s.collections)
  const jobs = useJobs((s) => s.jobs)
  const [menu, setMenu] = useState<{ book: BookSummary; x: number; y: number } | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeModal = useCallback(() => setModal(null), [])

  const call = (p: Promise<unknown>, ok?: string): void => {
    p.then(() => ok && toast.success(ok)).catch((e) => toast.error(err(e)))
  }

  const entries = (book: BookSummary): MenuEntry[] => {
    const busy =
      book.textStatus === 'processing' || activeJobs(jobs).some((j) => j.bookId === book.id)
    const setStatus = (status: ReadingStatus): void =>
      call(window.api.books.update({ id: book.id, status }))
    const list: MenuEntry[] = [
      {
        kind: 'item',
        label: 'Open',
        icon: BookOpen,
        onSelect: () => navigate(`/reader/${book.id}`)
      },
      {
        kind: 'item',
        label: 'Edit details…',
        icon: Pencil,
        onSelect: () => setModal({ kind: 'edit', book })
      },
      { kind: 'separator' },
      { kind: 'heading', label: 'Status' },
      {
        kind: 'item',
        label: 'Unread',
        icon: book.status === 'unread' ? CircleDot : Circle,
        onSelect: () => setStatus('unread')
      },
      {
        kind: 'item',
        label: 'Reading',
        icon: book.status === 'reading' ? CircleDot : Circle,
        onSelect: () => setStatus('reading')
      },
      {
        kind: 'item',
        label: 'Finished',
        icon: book.status === 'finished' ? CheckCircle2 : Circle,
        onSelect: () => setStatus('finished')
      }
    ]
    const addable = collections.filter((c) => !book.collectionIds.includes(c.id))
    if (addable.length || currentCollectionId)
      list.push({ kind: 'separator' }, { kind: 'heading', label: 'Collections' })
    for (const c of addable) {
      list.push({
        kind: 'item',
        label: `Add to ${c.name}`,
        icon: FolderPlus,
        onSelect: () => call(window.api.collections.addBook(c.id, book.id), `Added to ${c.name}.`)
      })
    }
    const current = collections.find((c) => c.id === currentCollectionId)
    if (current && book.collectionIds.includes(current.id)) {
      list.push({
        kind: 'item',
        label: `Remove from ${current.name}`,
        icon: FolderMinus,
        onSelect: () => call(window.api.collections.removeBook(current.id, book.id))
      })
    }
    list.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Export notes…',
        icon: Download,
        onSelect: () =>
          call(
            window.api.exports
              .markdown(book.id)
              .then((r) => r && toast.success(`Exported to ${r.path}`))
          )
      },
      {
        kind: 'item',
        label: 'Show in folder',
        icon: FolderOpen,
        onSelect: () => call(window.api.books.showInFolder(book.id))
      },
      {
        kind: 'item',
        label: 'Re-read text',
        icon: RefreshCw,
        disabled: busy,
        onSelect: () => call(window.api.books.reextract(book.id))
      }
    )
    if (book.format === 'pdf') {
      list.push({
        kind: 'item',
        label: 'Recognize text (OCR)…',
        icon: ScanText,
        disabled: busy,
        onSelect: () => setModal({ kind: 'ocr', book })
      })
    }
    list.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Delete…',
        icon: Trash2,
        danger: true,
        onSelect: () => setModal({ kind: 'delete', book })
      }
    )
    return list
  }

  const node = (
    <>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label={`Actions for ${menu.book.title}`}
          entries={entries(menu.book)}
          onClose={closeMenu}
        />
      )}
      {modal?.kind === 'edit' && <EditBookModal bookId={modal.book.id} onClose={closeModal} />}
      {modal?.kind === 'delete' && <DeleteBookModal book={modal.book} onClose={closeModal} />}
      {modal?.kind === 'ocr' && <OcrModal book={modal.book} onClose={closeModal} />}
    </>
  )

  return {
    open: (book, at) => setMenu({ book, ...at }),
    edit: (book) => setModal({ kind: 'edit', book }),
    node
  }
}
