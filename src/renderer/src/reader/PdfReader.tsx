import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useLatest } from '../lib/useLatest'
import type { FormatReaderProps, SearchMatch, TocItem } from './types'
import { PAGE_COLORS } from './types'
import { excerpt, findAll } from './search'
import { PdfThumbnails } from './PdfThumbnails'
import { HIGHLIGHT_HEX } from './types'
import { contains, mergeLineRects, toPageFraction, type FracRect } from './geometry'
import type { Annotation } from '../../../shared/ipc'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
// The viewer component reads the core library from this global.
;(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib
const viewerModule = import('pdfjs-dist/web/pdf_viewer.mjs')

/** pdf.js's own fonts, cmaps and image decoders, served by the main process. */
const ASSETS = 'book://pdfjs-assets'

type Viewer = InstanceType<Awaited<typeof viewerModule>['PDFViewer']>
type Bus = InstanceType<Awaited<typeof viewerModule>['EventBus']>

function flattenToc(
  items: TocItem[],
  out: Array<{ page: number; label: string }> = []
): Array<{ page: number; label: string }> {
  for (const i of items) {
    const p = pageOf(i.location)
    if (p) out.push({ page: p, label: i.label })
    if (i.children) flattenToc(i.children, out)
  }
  return out.sort((a, b) => a.page - b.page)
}

/** Draws highlight bars into a rendered page. pdf.js rebuilds page contents on zoom, so this reruns. */
function drawHighlights(viewer: Viewer, pageNumber: number, annotations: Annotation[]): void {
  const div = viewer.getPageView(pageNumber - 1)?.div as HTMLElement | undefined
  if (!div?.querySelector('.canvasWrapper')) return
  div.querySelector('.sl-annot-layer')?.remove()
  const mine = annotations.filter((a) => a.anchor.kind === 'pdf' && a.anchor.page === pageNumber)
  if (!mine.length) return
  const layer = document.createElement('div')
  layer.className = 'sl-annot-layer'
  for (const a of mine) {
    if (a.anchor.kind !== 'pdf') continue
    for (const [x, y, w, h] of a.anchor.rects) {
      const bar = document.createElement('div')
      bar.dataset.annotationId = a.id
      bar.className = a.note ? 'sl-annot sl-annot-noted' : 'sl-annot'
      bar.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;background:${HIGHLIGHT_HEX[a.color ?? 'yellow']}`
      layer.appendChild(bar)
    }
  }
  // Below the text layer so text stays selectable; the layer itself ignores the mouse.
  div.querySelector('.canvasWrapper')?.after(layer)
}

/** Which highlight (if any) is under a click. */
function hitTest(e: MouseEvent, annotations: Annotation[]): { id: string; rect: DOMRect } | null {
  const pageDiv = (e.target as HTMLElement | null)?.closest<HTMLElement>('.page')
  if (!pageDiv) return null
  const page = Number(pageDiv.dataset.pageNumber)
  const pr = pageDiv.getBoundingClientRect()
  const px = (e.clientX - pr.left) / pr.width
  const py = (e.clientY - pr.top) / pr.height
  for (const a of annotations) {
    if (a.anchor.kind !== 'pdf' || a.anchor.page !== page) continue
    if (a.anchor.rects.some((r) => contains(r, px, py))) {
      const bar = pageDiv.querySelector(`[data-annotation-id="${a.id}"]`)
      return {
        id: a.id,
        rect: bar?.getBoundingClientRect() ?? new DOMRect(e.clientX, e.clientY, 1, 1)
      }
    }
  }
  return null
}

function pageOf(location: string | null): number | null {
  const m = location?.match(/^page:(\d+)$/)
  return m ? Number(m[1]) : null
}

async function outlineToToc(pdf: PDFDocumentProxy): Promise<TocItem[]> {
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline) return []
  const convert = async (items: typeof outline): Promise<TocItem[]> => {
    const out: TocItem[] = []
    for (const item of items) {
      let page: number | null = null
      try {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
        if (Array.isArray(dest) && dest[0]) {
          page = (typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])) + 1
        }
      } catch {
        // unresolved destinations are skipped
      }
      const children = item.items?.length ? await convert(item.items) : undefined
      if (page) out.push({ label: item.title, location: `page:${page}`, children })
      else if (children?.length) out.push(...children)
    }
    return out
  }
  return convert(outline)
}

export function PdfReader({
  session,
  prefs,
  initialLocation,
  onReady,
  onPosition,
  onError,
  handleRef,
  annotations,
  onSelection,
  onAnnotationClick,
  showThumbnails
}: FormatReaderProps & { showThumbnails: boolean }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const busRef = useRef<Bus | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const textCache = useRef(new Map<number, string>())
  // Latest callbacks, so load effects don't re-run when the parent re-renders.
  const cb = useLatest({ onReady, onPosition, onError, onSelection, onAnnotationClick })
  const annRef = useLatest(annotations)
  /** Flattened outline (page → chapter title) for labelling highlights. */
  const tocRef = useRef<Array<{ page: number; label: string }>>([])
  const initial = useRef({ location: initialLocation, zoom: prefs.pdfZoom })

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    void (async () => {
      const { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget } =
        await viewerModule
      const container = containerRef.current
      if (!container || cancelled) return
      const eventBus = new EventBus()
      const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK })
      const findController = new PDFFindController({ eventBus, linkService })
      const viewer = new PDFViewer({ container, eventBus, linkService, findController })
      linkService.setViewer(viewer)
      viewerRef.current = viewer
      busRef.current = eventBus

      task = pdfjsLib.getDocument({
        url: session.fileUrl,
        standardFontDataUrl: `${ASSETS}/standard_fonts/`,
        cMapUrl: `${ASSETS}/cmaps/`,
        wasmUrl: `${ASSETS}/wasm/`,
        iccUrl: `${ASSETS}/iccs/`
      })
      let doc: PDFDocumentProxy
      try {
        doc = await task.promise
      } catch (e) {
        if (!cancelled) cb.current.onError(`Couldn’t open this PDF: ${(e as Error).message}`)
        return
      }
      if (cancelled) return
      viewer.setDocument(doc)
      linkService.setDocument(doc)
      setPdf(doc)

      eventBus.on('pagesinit', () => {
        viewer.currentScaleValue = String(initial.current.zoom)
        const p = pageOf(initial.current.location)
        if (p) viewer.currentPageNumber = Math.min(p, doc.numPages)
      })
      eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
        setPage(pageNumber)
        cb.current.onPosition({
          location: `page:${pageNumber}`,
          progress: doc.numPages > 1 ? (pageNumber - 1) / (doc.numPages - 1) : 1,
          label: `Page ${pageNumber} of ${doc.numPages}`
        })
      })
      cb.current.onPosition({
        location: `page:${pageOf(initial.current.location) ?? 1}`,
        progress: 0,
        label: `Page ${pageOf(initial.current.location) ?? 1} of ${doc.numPages}`
      })
      eventBus.on('pagerendered', ({ pageNumber }: { pageNumber: number }) =>
        drawHighlights(viewer, pageNumber, annRef.current)
      )
      const toc = await outlineToToc(doc)
      tocRef.current = flattenToc(toc)
      cb.current.onReady({ toc })
    })()
    return () => {
      cancelled = true
      viewerRef.current?.cleanup()
      viewerRef.current = null
      void task?.destroy()
    }
  }, [session.fileUrl, cb, annRef])

  // Redraw highlights on every rendered page when annotations change.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer?.pdfDocument) return
    for (let n = 1; n <= viewer.pagesCount; n++) drawHighlights(viewer, n, annotations)
  }, [annotations])

  // Selecting text → offer a highlight; clicking a highlight → edit it.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onMouseUp = (e: MouseEvent): void => {
      // Let the browser finish updating the selection first.
      setTimeout(() => {
        const viewer = viewerRef.current
        const doc = viewer?.pdfDocument
        if (!viewer || !doc) return
        const sel = document.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          const hit = hitTest(e, annRef.current)
          if (hit) cb.current.onAnnotationClick(hit.id, hit.rect)
          else cb.current.onSelection(null)
          return
        }
        const range = sel.getRangeAt(0)
        const pageDiv = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>('.page')
        if (!pageDiv || !container.contains(pageDiv)) return
        const text = sel.toString().replace(/\s+/g, ' ').trim()
        if (!text) return
        const page = Number(pageDiv.dataset.pageNumber)
        const pr = pageDiv.getBoundingClientRect()
        // Only rects on the start page; a selection spanning pages is highlighted on its first page.
        const rects = mergeLineRects(
          [...range.getClientRects()]
            .map((r) => toPageFraction(r, pr))
            .filter((r): r is FracRect => !!r && r[3] < 0.1)
        )
        if (!rects.length) return
        const top = rects[0][1]
        const chapter = [...tocRef.current].reverse().find((t) => t.page <= page)?.label ?? null
        const br = range.getBoundingClientRect()
        cb.current.onSelection({
          anchor: { kind: 'pdf', page, rects },
          location: `page:${page}`,
          chapter,
          sortKey: Math.min(1, (page - 1 + top) / doc.numPages),
          text,
          rect: { left: br.left, top: br.top, width: br.width, height: br.height },
          clear: () => sel.removeAllRanges()
        })
      }, 0)
    }
    container.addEventListener('mouseup', onMouseUp)
    return () => container.removeEventListener('mouseup', onMouseUp)
  }, [cb, annRef])

  // Zoom changes after load.
  useEffect(() => {
    if (viewerRef.current?.pdfDocument) viewerRef.current.currentScaleValue = String(prefs.pdfZoom)
  }, [prefs.pdfZoom])

  const pageText = async (n: number): Promise<string> => {
    const cached = textCache.current.get(n)
    if (cached !== undefined) return cached
    const p = await (pdf as PDFDocumentProxy).getPage(n)
    const tc = await p.getTextContent()
    const text = tc.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? ' ' : '') : '')).join('')
    textCache.current.set(n, text)
    return text
  }

  useImperativeHandle(handleRef, () => ({
    goTo: (location) => {
      const p = pageOf(location)
      if (p && viewerRef.current) viewerRef.current.currentPageNumber = p
    },
    next: () => viewerRef.current?.nextPage(),
    prev: () => viewerRef.current?.previousPage(),
    search: async (query, signal) => {
      if (!pdf) return []
      const out: SearchMatch[] = []
      for (let n = 1; n <= pdf.numPages && out.length < 300; n++) {
        if (signal.aborted) break
        const text = await pageText(n)
        for (const m of findAll(text, query, 50)) {
          out.push({
            location: `page:${n}`,
            label: `Page ${n}`,
            excerpt: excerpt(text, m.start, m.end)
          })
        }
      }
      return out
    },
    showMatch: (query) => {
      // Let pdf.js highlight every occurrence on the visible pages.
      busRef.current?.dispatch('find', {
        source: null,
        type: '',
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
        matchDiacritics: false
      })
    },
    clearSearch: () => busRef.current?.dispatch('findbarclose', { source: null }),
    getScale: () => viewerRef.current?.currentScale ?? 1,
    isAt: (location) => pageOf(location) === viewerRef.current?.currentPageNumber
  }))

  const colors = PAGE_COLORS[prefs.theme]
  return (
    <div className="flex h-full min-h-0">
      {showThumbnails && pdf && (
        <PdfThumbnails
          pdf={pdf}
          current={page}
          onSelect={(n) => {
            if (viewerRef.current) viewerRef.current.currentPageNumber = n
          }}
        />
      )}
      <div
        className={`sl-pdf relative min-w-0 flex-1 sl-pdf-${prefs.theme}`}
        style={{ background: prefs.theme === 'light' ? '#e9e4da' : colors.bg }}
      >
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto"
          tabIndex={0}
          aria-label="PDF pages"
        >
          <div className="pdfViewer" />
        </div>
      </div>
    </div>
  )
}
