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

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
// The viewer component reads the core library from this global.
;(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib
const viewerModule = import('pdfjs-dist/web/pdf_viewer.mjs')

/** pdf.js's own fonts, cmaps and image decoders, served by the main process. */
const ASSETS = 'book://pdfjs-assets'

type Viewer = InstanceType<Awaited<typeof viewerModule>['PDFViewer']>
type Bus = InstanceType<Awaited<typeof viewerModule>['EventBus']>

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
  showThumbnails
}: FormatReaderProps & { showThumbnails: boolean }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const busRef = useRef<Bus | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const textCache = useRef(new Map<number, string>())
  // Latest callbacks without re-running the load effect.
  // Latest callbacks, so load effects don't re-run when the parent re-renders.
  const cb = useLatest({ onReady, onPosition, onError })
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
      cb.current.onReady({ toc: await outlineToToc(doc) })
    })()
    return () => {
      cancelled = true
      viewerRef.current?.cleanup()
      viewerRef.current = null
      void task?.destroy()
    }
  }, [session.fileUrl, cb])

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
    getScale: () => viewerRef.current?.currentScale ?? 1
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
