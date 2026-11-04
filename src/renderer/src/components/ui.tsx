import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-border px-10 pt-10 pb-6">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Icon size={26} strokeWidth={1.5} aria-hidden />
      </div>
      <h2 className="font-serif text-xl">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): React.JSX.Element {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-text hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-surface hover:bg-sunken',
        variant === 'ghost' && 'text-muted hover:bg-sunken hover:text-text',
        variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger/10',
        className
      )}
    />
  )
}

export function Section({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="grid grid-cols-[220px_1fr] gap-8 border-b border-border py-8 last:border-b-0">
      <div>
        <h2 className="font-medium">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit rounded-lg border border-border bg-sunken p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            value === o.value
              ? 'bg-surface font-medium text-text shadow-sm ring-1 ring-border'
              : 'text-muted hover:text-text'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
