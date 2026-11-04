import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { cn } from '../lib/cn'

const WIDTH = 112

function Thumb({
  pdf,
  n,
  active,
  onSelect
}: {
  pdf: PDFDocumentProxy
  n: number
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const btn = useRef<HTMLButtonElement>(null)

  // Render only when scrolled into view; a 900-page PDF must not render 900 canvases up front.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let done = false
    let task: { cancel: () => void } | null = null
    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting || done) return
        done = true
        io.disconnect()
        const page = await pdf.getPage(n)
        const vp = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (WIDTH * devicePixelRatio) / vp.width })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const render = page.render({ canvas, viewport })
        task = render
        await render.promise.catch(() => undefined)
      },
      { rootMargin: '400px' }
    )
    io.observe(canvas)
    return () => {
      io.disconnect()
      task?.cancel()
    }
  }, [pdf, n])

  useEffect(() => {
    if (active) btn.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={btn}
      onClick={onSelect}
      aria-label={`Page ${n}`}
      aria-current={active ? 'page' : undefined}
      className="flex flex-col items-center gap-1 py-2"
    >
      <canvas
        ref={ref}
        style={{ width: WIDTH, aspectRatio: '0.707' }}
        className={cn('bg-white shadow-sm', active ? 'ring-2 ring-accent' : 'ring-1 ring-border')}
      />
      <span className={cn('text-xs', active ? 'font-medium text-accent' : 'text-muted')}>{n}</span>
    </button>
  )
}

export function PdfThumbnails({
  pdf,
  current,
  onSelect
}: {
  pdf: PDFDocumentProxy
  current: number
  onSelect: (n: number) => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Pages"
      className="flex w-40 shrink-0 flex-col items-center overflow-y-auto border-r border-border bg-surface py-2"
    >
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Thumb
          key={i}
          pdf={pdf}
          n={i + 1}
          active={current === i + 1}
          onSelect={() => onSelect(i + 1)}
        />
      ))}
    </nav>
  )
}
