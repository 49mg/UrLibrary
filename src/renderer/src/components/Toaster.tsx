import { X } from 'lucide-react'
import { useToasts } from '../stores/toasts'
import { cn } from '../lib/cn'

export function Toaster(): React.JSX.Element {
  const { toasts, dismiss } = useToasts()
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-sm shadow-lg',
            t.tone === 'error' && 'border-danger/40',
            t.tone === 'success' && 'border-success/40',
            t.tone === 'info' && 'border-border'
          )}
        >
          <span
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              t.tone === 'error' ? 'bg-danger' : t.tone === 'success' ? 'bg-success' : 'bg-accent'
            )}
            aria-hidden
          />
          <p className="flex-1">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="text-muted hover:text-text"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
