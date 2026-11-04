import { AlertTriangle, Loader2, ScanText } from 'lucide-react'
import type { BookSummary } from '../../../shared/ipc'

/** Small badge for the text-extraction state. Renders nothing when the book is ready. */
export function TextStatusBadge({ book }: { book: BookSummary }): React.JSX.Element | null {
  switch (book.textStatus) {
    case 'pending':
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" aria-hidden /> Reading text…
        </span>
      )
    case 'needs_ocr':
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-accent"
          title="This looks like a scanned PDF"
        >
          <ScanText size={12} aria-hidden /> Scanned — needs OCR
        </span>
      )
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-danger">
          <AlertTriangle size={12} aria-hidden /> Text unavailable
        </span>
      )
    default:
      return null
  }
}
