import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'

export type MenuEntry =
  | {
      kind: 'item'
      label: string
      icon?: LucideIcon
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
    }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }

/**
 * Floating menu at a screen position (context menu or "⋯" button). Closes on outside click,
 * Escape, scroll or selection. Arrow keys move between items.
 */
export function Menu({
  x,
  y,
  entries,
  onClose,
  label
}: {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
  label: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    })
  }, [x, y])

  useEffect(() => {
    const onClose = (): void => closeRef.current()
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [
        ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      ]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next]?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={pos}
      className="fixed z-50 max-h-[70vh] min-w-52 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl"
    >
      {entries.map((e, i) =>
        e.kind === 'separator' ? (
          <div key={i} className="my-1 border-t border-border" role="separator" />
        ) : e.kind === 'heading' ? (
          <div
            key={i}
            className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase"
          >
            {e.label}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={e.disabled}
            onClick={() => {
              onClose()
              e.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm outline-none disabled:opacity-40',
              e.danger
                ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                : 'hover:bg-sunken focus:bg-sunken'
            )}
          >
            {e.icon && <e.icon size={15} aria-hidden className="shrink-0 opacity-80" />}
            <span className="truncate">{e.label}</span>
          </button>
        )
      )}
    </div>
  )
}
