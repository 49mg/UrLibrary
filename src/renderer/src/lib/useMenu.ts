import { useCallback, useState } from 'react'

/** Small helper for components that open a Menu at the mouse or under a button. */
export function useMenu(): {
  menu: { x: number; y: number } | null
  openAt: (e: React.MouseEvent) => void
  openBelow: (e: React.MouseEvent<HTMLElement>) => void
  close: () => void
} {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const close = useCallback(() => setMenu(null), [])
  return {
    menu,
    openAt: (e) => {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY })
    },
    openBelow: (e) => {
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      setMenu({ x: r.left, y: r.bottom + 4 })
    },
    close
  }
}
