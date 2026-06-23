import { NavLink } from 'react-router-dom'
import {
  LayoutGrid,
  GanttChart,
  Home,
  Sheet,
  Bell,
  CheckSquare,
  Activity,
  ShieldCheck,
  Settings,
  Menu,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { useAuth, canSeeActivities, canSeeAdminPage } from '@/context/auth'
import type { User } from '@/lib/types'
import clsx from 'clsx'

interface Props {
  collapsed: boolean
  onToggle: () => void
  profile: User
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  show: boolean
}

export default function Sidebar({ collapsed, onToggle, profile }: Props) {
  const { signOut } = useAuth()

  const items: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutGrid, show: true },
    { to: '/pipeline', label: 'Pipeline', icon: GanttChart, show: true },
    { to: '/merchants', label: 'All Leads', icon: Home, show: true },
    { to: '/my-projects', label: 'My Projects', icon: Sheet, show: true },
    { to: '/reminders', label: 'Reminders', icon: Bell, show: true },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare, show: true },
    {
      to: '/activities',
      label: 'Activities',
      icon: Activity,
      show: canSeeActivities(profile.role),
    },
    {
      to: '/admin',
      label: 'Admin',
      icon: ShieldCheck,
      show: canSeeAdminPage(profile.role),
    },
    { to: '/settings', label: 'Settings', icon: Settings, show: true },
  ]

  return (
    <nav
      className={clsx(
        'flex h-full flex-col flex-shrink-0 bg-primary text-white transition-[width] duration-200 overflow-hidden',
        collapsed ? 'w-[52px]' : 'w-[230px]',
      )}
    >
      <div className="flex min-h-[52px] items-center gap-2.5 border-b border-white/5 p-2.5">
        <button
          onClick={onToggle}
          aria-label="Toggle sidebar"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Menu size={18} />
        </button>
        <div
          className={clsx(
            'overflow-hidden whitespace-nowrap transition-opacity',
            collapsed && 'pointer-events-none opacity-0',
          )}
        >
          <div className="font-display text-[17px] font-extrabold leading-none">
            kreateandco
          </div>
          <div className="text-[10px] text-white/30">Sales Platform</div>
        </div>
      </div>

      <div
        className={clsx(
          'px-4 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20 transition-opacity whitespace-nowrap',
          collapsed && 'opacity-0',
        )}
      >
        Main
      </div>

      <div className="flex flex-col">
        {items
          .filter((i) => i.show)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={item.label}
              className={({ isActive }) =>
                clsx(
                  'relative mx-2 my-px flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                  isActive
                    ? 'bg-secondary font-medium text-ink-1'
                    : 'text-white/60 hover:bg-secondary/30 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r bg-secondary" />
                  )}
                  <item.icon
                    size={15}
                    className={clsx(
                      'flex-shrink-0 transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-70',
                    )}
                  />
                  <span
                    className={clsx(
                      'overflow-hidden transition-opacity',
                      collapsed && 'opacity-0',
                    )}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
      </div>

      <div className="mt-auto border-t border-white/5 p-2.5">
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-lg p-2 text-left transition-colors hover:bg-white/5"
          title="Sign out"
        >
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ background: profile.color }}
          >
            {profile.name[0]?.toUpperCase()}
          </div>
          <div
            className={clsx(
              'flex-1 overflow-hidden transition-opacity',
              collapsed && 'opacity-0',
            )}
          >
            <div className="text-[13px] font-medium text-white/85">
              {profile.name}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-white/30">
              {profile.role}
            </div>
          </div>
          <LogOut
            size={14}
            className={clsx(
              'flex-shrink-0 text-white/40 transition-opacity',
              collapsed && 'opacity-0',
            )}
          />
        </button>
      </div>
    </nav>
  )
}
