import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui'

/** Accessible dialog: focuses itself, closes on Escape or backdrop click, restores focus on close. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg'
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Callers pass inline callbacks; a ref keeps the focus effect from re-running on every render.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(
      'input, textarea, select, button[data-autofocus]'
    )
    ;(first ?? ref.current)?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${width} rounded-xl border border-border bg-surface shadow-2xl outline-none`}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="font-serif text-lg">
            {title}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            data-autofocus
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
    </Modal>
  )
}
