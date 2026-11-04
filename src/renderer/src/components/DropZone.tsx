import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { importWith } from '../lib/importFlow'

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')

/** Window-wide drop target for importing files and folders from the desktop. */
export function DropZone(): React.JSX.Element | null {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setActive(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setActive(false)
    }
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setActive(false)
      const paths = [...(e.dataTransfer?.files ?? [])]
        .map((f) => window.api.library.pathForFile(f))
        .filter(Boolean)
      if (paths.length) void importWith(() => window.api.library.importPaths(paths))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-8 backdrop-blur-sm">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent text-center">
        <Upload size={36} className="text-accent" aria-hidden />
        <p className="font-serif text-2xl">Drop to add to your library</p>
        <p className="text-sm text-muted">
          PDF, EPUB, Word, text and Markdown files — or whole folders
        </p>
      </div>
    </div>
  )
}
