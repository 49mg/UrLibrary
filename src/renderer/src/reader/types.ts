import type {
  Anchor,
  Annotation,
  HighlightColor,
  ReaderPrefs,
  ReaderSession
} from '../../../shared/ipc'

export interface TocItem {
  label: string
  /** Same format as saved locations: `page:3`, `cfi:...`, `href:...`, `heading:2`, `section:1` */
  location: string
  children?: TocItem[]
}

export interface SearchMatch {
  location: string
  /** Text around the match, with the match wrapped in SNIPPET_START / SNIPPET_END. */
  excerpt: string
  /** Where it is, e.g. "Page 4" or a chapter title. */
  label?: string
}

export interface ReaderPosition {
  location: string
  /** 0..1 through the book */
  progress: number
  /** Human label for the toolbar, e.g. "Page 4 of 120" or the chapter title. */
  label: string
}

/** Imperative controls every format reader exposes to the shared reader chrome. */
export interface ReaderHandle {
  goTo: (location: string) => void
  next: () => void
  prev: () => void
  search: (query: string, signal: AbortSignal) => Promise<SearchMatch[]>
  /** Highlights the given match in the page (after goTo) and clears others. */
  showMatch?: (query: string, match: SearchMatch) => void
  clearSearch: () => void
  /** PDF only: the actual zoom factor (resolves 'page-width' etc.). */
  getScale?: () => number
  /** Whether a saved location is on the page/screen the reader currently shows (for bookmarks). */
  isAt: (location: string) => boolean
}

/** Text the user just selected, ready to become a highlight. */
export interface PendingSelection {
  anchor: Anchor
  location: string
  chapter: string | null
  sortKey: number
  text: string
  /** Viewport rect of the selection, to place the popover. */
  rect: { left: number; top: number; width: number; height: number }
  /** Clears the native selection once handled. */
  clear: () => void
}

export interface FormatReaderProps {
  session: ReaderSession
  prefs: ReaderPrefs
  /** Where to open: an explicit target (search hit) or the saved position. */
  initialLocation: string | null
  onReady: (info: { toc: TocItem[] }) => void
  onPosition: (pos: ReaderPosition) => void
  onError: (message: string) => void
  /** Lets readers that render inside iframes (EPUB) forward keyboard shortcuts. */
  onKey: (e: KeyboardEvent) => void
  handleRef: React.RefObject<ReaderHandle | null>
  /** Highlights (and bookmarks, which readers ignore) to draw. */
  annotations: Annotation[]
  /** null = the selection was cleared or the user clicked empty space. */
  onSelection: (sel: PendingSelection | null) => void
  onAnnotationClick: (id: string, rect: PendingSelection['rect']) => void
}

/** Page colors for the reading surface; independent of the app theme. */
export const PAGE_COLORS: Record<ReaderPrefs['theme'], { bg: string; fg: string; muted: string }> =
  {
    light: { bg: '#fffdf9', fg: '#23201a', muted: '#6f675a' },
    sepia: { bg: '#f4ecd8', fg: '#4a3b28', muted: '#7d6b52' },
    dark: { bg: '#1b1915', fg: '#ddd5c7', muted: '#9a917f' }
  }

export const FONT_STACKS: Record<ReaderPrefs['fontFamily'], string> = {
  serif:
    "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Noto Serif', serif",
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', sans-serif"
}

/** On-screen colors for highlights (translucent fills over the text). */
export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  yellow: '#f6d155',
  green: '#8fd16f',
  blue: '#7fb8f5',
  pink: '#f59ab8',
  purple: '#b99af5'
}
