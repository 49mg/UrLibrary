import { useCallback, useEffect, useState } from 'react'
import type { Annotation, HighlightColor, NewAnnotation } from '../../../shared/ipc'
import { toast } from '../stores/toasts'

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** A book's annotations, kept in reading order and in sync with changes made elsewhere. */
export function useAnnotations(bookId: string): {
  annotations: Annotation[]
  create: (a: Omit<NewAnnotation, 'bookId'>) => Promise<Annotation | null>
  update: (id: string, patch: { note?: string | null; color?: HighlightColor }) => Promise<void>
  remove: (id: string) => Promise<void>
} {
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  const reload = useCallback(() => {
    window.api.annotations
      .list(bookId)
      .then(setAnnotations)
      .catch((e) => toast.error(`Couldn’t load notes: ${err(e)}`))
  }, [bookId])

  useEffect(() => {
    reload()
    return window.api.on('annotations:changed', (e) => {
      if (e.bookId === bookId) reload()
    })
  }, [bookId, reload])

  const sorted = (list: Annotation[]): Annotation[] =>
    [...list].sort((a, b) => a.sortKey - b.sortKey || a.createdAt.localeCompare(b.createdAt))

  return {
    annotations,
    create: async (a) => {
      try {
        const created = await window.api.annotations.create({ ...a, bookId })
        setAnnotations((list) => sorted([...list.filter((x) => x.id !== created.id), created]))
        return created
      } catch (e) {
        toast.error(`Couldn’t save: ${err(e)}`)
        return null
      }
    },
    update: async (id, patch) => {
      try {
        const updated = await window.api.annotations.update(id, patch)
        setAnnotations((list) => list.map((x) => (x.id === id ? updated : x)))
      } catch (e) {
        toast.error(`Couldn’t save: ${err(e)}`)
      }
    },
    remove: async (id) => {
      setAnnotations((list) => list.filter((x) => x.id !== id))
      try {
        await window.api.annotations.delete(id)
      } catch (e) {
        toast.error(`Couldn’t delete: ${err(e)}`)
        reload()
      }
    }
  }
}
