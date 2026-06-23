import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, RefreshCw, Search } from 'lucide-react'
import { useMerchantDetail } from '@/context/merchantDetail'
import { useMerchantSearch } from '@/hooks/useMerchantSearch'
import { refreshAllCollections } from '@/hooks/useCollection'
import { useScopedReminders } from '@/hooks/useScopedCollections'

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/pipeline': 'Pipeline',
  '/merchants': 'All Leads',
  '/my-projects': 'My Projects',
  '/reminders': 'Reminders',
  '/activities': 'Activities',
  '/admin': 'Admin',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function strColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  const palette = [
    '#5B4FCF',
    '#0f9e6e',
    '#1565c0',
    '#e91e63',
    '#b87209',
    '#6d28d9',
    '#d63c2e',
    '#FF6B5E',
  ]
  return palette[Math.abs(h) % palette.length]
}

export default function Topbar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const title = TITLES[pathname] ?? 'kreateandco'

  const { open } = useMerchantDetail()
  const { data: reminders } = useScopedReminders()

  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshAllCollections()
    } finally {
      setRefreshing(false)
    }
  }

  // Search merchants on demand (Firestore prefix query, debounced) rather than
  // filtering a full in-memory copy of the collection.
  const { hits } = useMerchantSearch(q)

  // The All Merchants page has its own search input; hiding this one
  // avoids a duplicated control in the header.
  const showSearch = pathname !== '/merchants'

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // NOTE: We deliberately do NOT auto-refresh on tab focus/visibility change.
  // With large collections (e.g. ~3k merchants) that turned every alt-tab into
  // a full re-read of every cached collection and blew through the read quota.
  // Refreshing is now explicit only: the button below, page navigation, and the
  // automatic refresh after a write.

  // useScopedReminders has already filtered to docs this user is allowed
  // to see (reps get only their own); the canSeeAll branch is gone.
  const undismissedCount = useMemo(
    () => reminders.filter((r) => !r.dismissed).length,
    [reminders],
  )

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-line bg-white px-5">
      <div className="font-display min-w-[130px] text-[15px] font-bold text-ink-1">
        {title}
      </div>

      {showSearch && (
        <div ref={wrapRef} className="relative max-w-[340px] flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            type="text"
            value={q}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              setQ(e.target.value)
              setFocused(true)
            }}
            placeholder="Search leads — type at least 3 letters…"
            className="w-full rounded-lg border-[1.5px] border-line bg-ghost px-3 py-1.5 pl-8 text-[13px] text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-major focus:bg-white"
          />
          {focused && q.trim().length >= 3 && (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[300] max-h-[320px] overflow-y-auto rounded-[10px] border border-line bg-white shadow-[0_8px_28px_rgba(11,31,75,.12)]">
              {hits.length === 0 ? (
                <div className="px-3.5 py-3.5 text-center text-[13px] text-ink-3">
                  No results for "{q}"
                </div>
              ) : (
                hits.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      open(m.id)
                      setQ('')
                      setFocused(false)
                    }}
                    className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-ghost"
                  >
                    <div
                      className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold text-white"
                      style={{ background: strColor(m.name) }}
                    >
                      {initials(m.name)}
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold">{m.name}</div>
                      <div className="text-[11px] text-ink-3">
                        {m.industry || '—'}
                        {m.contact ? ` · ${m.contact}` : ''}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh data"
          title="Refresh data"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border-[1.5px] border-line bg-white transition-colors hover:bg-ghost disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            size={15}
            className={refreshing ? 'animate-spin' : undefined}
          />
        </button>
        <button
          onClick={() => navigate('/reminders')}
          aria-label="Notifications"
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-lg border-[1.5px] border-line bg-white transition-colors hover:bg-ghost"
        >
          <Bell size={15} />
          {undismissedCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full border-2 border-white bg-bitter" />
          )}
        </button>
      </div>
    </header>
  )
}
