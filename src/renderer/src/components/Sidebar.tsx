import { NavLink } from 'react-router'
import { BookOpen, Compass, Library, Settings, Sparkles, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { JobsIndicator } from './JobsIndicator'

const NAV: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/library', label: 'Library', icon: Library },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/reader', label: 'Reader', icon: BookOpen },
  { to: '/ai', label: 'AI Studio', icon: Sparkles }
]

function Item({
  to,
  label,
  icon: Icon
}: {
  to: string
  label: string
  icon: LucideIcon
}): React.JSX.Element {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-accent-soft text-accent font-medium'
            : 'text-muted hover:bg-sunken hover:text-text'
        )
      }
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      {label}
    </NavLink>
  )
}

export function Sidebar(): React.JSX.Element {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-5">
      <div className="mb-6 px-3">
        <span className="font-serif text-xl tracking-tight">Ur Library</span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map((n) => (
          <Item key={n.to} {...n} />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <JobsIndicator />
        <Item to="/settings" label="Settings" icon={Settings} />
      </div>
    </aside>
  )
}
