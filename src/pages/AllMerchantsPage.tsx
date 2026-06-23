import { memo, useMemo, useState, type CSSProperties } from 'react'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'
import { Plus, Search, FolderPlus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useCollection } from '@/hooks/useCollection'
import { useScopedDeals } from '@/hooks/useScopedCollections'
import { usePaginatedMerchants } from '@/hooks/usePaginatedMerchants'
import { useIndustries } from '@/hooks/useIndustries'
import { useSubcategories } from '@/hooks/useSubcategories'
import {
  COL,
  type Deal,
  type Merchant,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'
import MerchantDetailModal from '@/components/merchants/MerchantDetailModal'
import AddMerchantModal from '@/components/merchants/AddMerchantModal'
import BulkAddToProjectModal from '@/components/merchants/BulkAddToProjectModal'
import ReassignMerchantDealsModal from '@/components/merchants/ReassignMerchantDealsModal'
import { ProjectBadge } from '@/components/ui/StatusBadge'
import StatusBadge from '@/components/ui/StatusBadge'
import Button from '@/components/ui/Button'
import DateRangeBar from '@/components/ui/DateRangeBar'
import { useDateRange } from '@/context/date-range'
import { useProfile, canReassign, isAdmin } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { downloadCsv } from '@/lib/export'
import {
  reassignDeal,
  deleteMerchant,
  logActivity,
  updateMerchant,
} from '@/lib/data'

const NO_DEALS_STATUS = '__none__'

// Shared grid template between the header row and every data row so columns
// stay aligned. Two variants depending on whether the delete column is
// visible (admin-only).
const GRID_COLS_BASE =
  '40px minmax(180px,2fr) 110px 120px minmax(120px,1.2fr) 120px minmax(140px,1.4fr) minmax(160px,1.4fr) 120px'
const GRID_COLS_WITH_DELETE = `${GRID_COLS_BASE} 48px`
const ROW_HEIGHT = 56
const LIST_MAX_HEIGHT = 640

export default function AllMerchantsPage() {
  const me = useProfile()
  const toast = useToast()
  const { inRange, preset: datePreset } = useDateRange()
  const { data: deals } = useScopedDeals()
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: stages } = useCollection<Stage>(COL.stages)
  const { data: users } = useCollection<User>(COL.users)
  const { names: industries } = useIndustries()
  const { namesFor: subcategoriesFor } = useSubcategories()

  // `draftQ` is what the user is typing; `q` is the committed search applied
  // to the list. Hitting Enter (or the Search button) copies draft → q.
  const [draftQ, setDraftQ] = useState('')
  const [q, setQ] = useState('')
  const [industry, setIndustry] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [projectFilterId, setProjectFilterId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Paginated server-side reader — only loads PAGE_SIZE merchants at a time.
  // `q` and `industry` push down into Firestore; the other filters apply
  // client-side over what's been fetched (see "Project filter / status
  // filter" notes below).
  const {
    merchants,
    loading: merchantsLoading,
    loadingMore,
    hasMore,
    loadMore,
    reload: reloadMerchants,
    mutate: mutateMerchants,
  } = usePaginatedMerchants({ search: q, industry, subcategory })
  const [detailId, setDetailId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [reassignMerchant, setReassignMerchant] = useState<Merchant | null>(
    null,
  )
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const canManageOwners = canReassign(me.role)
  const canDelete = isAdmin(me.role)

  const dealsByMerchant = useMemo(() => {
    const map = new Map<string, Deal[]>()
    for (const d of deals) {
      if (!d.merchantId) continue
      const arr = map.get(d.merchantId) ?? []
      arr.push(d)
      map.set(d.merchantId, arr)
    }
    return map
  }, [deals])

  const stageOrder = useMemo(() => {
    const map = new Map<string, number>()
    stages.forEach((s) => map.set(s.name, s.order))
    return map
  }, [stages])

  function mostAdvancedStatus(merchantDeals: Deal[]): string | null {
    if (merchantDeals.length === 0) return null
    return merchantDeals.reduce((best, d) => {
      const o = stageOrder.get(d.status) ?? -1
      const bo = stageOrder.get(best) ?? -1
      return o > bo ? d.status : best
    }, merchantDeals[0].status)
  }

  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  // `q` and `industry` are applied server-side by usePaginatedMerchants —
  // we don't re-apply them here. The remaining filters operate over
  // already-fetched pages.
  const filtered = useMemo(() => {
    return merchants.filter((m) => {
      if (!inRange(m.createdAt?.toMillis?.())) return false
      if (projectFilterId) {
        const ds = dealsByMerchant.get(m.id) ?? []
        if (!ds.some((d) => d.projectId === projectFilterId)) return false
      }
      if (statusFilter) {
        const ds = dealsByMerchant.get(m.id) ?? []
        if (statusFilter === NO_DEALS_STATUS) {
          if (ds.length > 0) return false
        } else {
          let bestName: string | null = null
          let bestOrd = -1
          for (const d of ds) {
            const ord = stageOrder.get(d.status) ?? -1
            if (ord > bestOrd) {
              bestOrd = ord
              bestName = d.status
            }
          }
          if (bestName !== statusFilter) return false
        }
      }
      return true
    })
  }, [
    merchants,
    projectFilterId,
    statusFilter,
    dealsByMerchant,
    inRange,
    stageOrder,
  ])

  // True when filters that only run client-side could be hiding matches on
  // pages we haven't fetched yet — surfaces a banner so the user isn't
  // confused by an apparently-empty result.
  const clientFiltersActive =
    !!projectFilterId || !!statusFilter || datePreset !== 'all'

  // Selection: only count merchants currently visible (filter respect).
  const visibleIds = useMemo(
    () => new Set(filtered.map((m) => m.id)),
    [filtered],
  )
  const selectedVisible = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  )
  const selectedMerchants = useMemo(
    () => merchants.filter((m) => selected.has(m.id)),
    [merchants, selected],
  )

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      // If all visible are already selected, clear them; else select all visible.
      const allSelected = filtered.every((m) => prev.has(m.id))
      const next = new Set(prev)
      if (allSelected) {
        for (const m of filtered) next.delete(m.id)
      } else {
        for (const m of filtered) next.add(m.id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function handleExport() {
    const header = [
      'Lead',
      'Industry',
      'Subcategory',
      'Contact',
      'Role',
      'Phone',
      'Email',
      'Projects',
      'Owners',
      'Status',
      'Deal Count',
    ]
    const rows = filtered.map((m) => {
      const ds = dealsByMerchant.get(m.id) ?? []
      const projs = [
        ...new Set(
          ds
            .map((d) => projects.find((p) => p.id === d.projectId)?.name)
            .filter((n): n is string => !!n),
        ),
      ]
      const owners = [
        ...new Set(
          ds
            .map((d) => users.find((u) => u.id === d.repId)?.name)
            .filter((n): n is string => !!n),
        ),
      ]
      return [
        m.name,
        m.industry,
        m.subcategory,
        m.contact,
        m.contactRole,
        m.phone,
        m.email,
        projs.join('; '),
        owners.join('; '),
        mostAdvancedStatus(ds) ?? '',
        ds.length,
      ]
    })
    downloadCsv('all-leads', [header, ...rows])
  }

  async function handleDelete(merchant: Merchant) {
    const ds = dealsByMerchant.get(merchant.id) ?? []
    const msg =
      ds.length > 0
        ? `Delete "${merchant.name}" and its ${ds.length} deal${ds.length === 1 ? '' : 's'}? This cannot be undone.`
        : `Delete "${merchant.name}"? This cannot be undone.`
    if (!window.confirm(msg)) return
    setDeletingId(merchant.id)
    try {
      await deleteMerchant(
        merchant.id,
        ds.map((d) => d.id),
      )
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'merchant.delete',
        text: `deleted lead ${merchant.name}`,
        refId: merchant.id,
        refKind: 'merchant',
        meta: { dealCount: ds.length },
      })
      mutateMerchants((prev) => prev.filter((m) => m.id !== merchant.id))
      setSelected((prev) => {
        if (!prev.has(merchant.id)) return prev
        const next = new Set(prev)
        next.delete(merchant.id)
        return next
      })
      toast.show(`${merchant.name} deleted`)
    } catch (err) {
      toast.show(
        err instanceof Error
          ? err.message
          : "Couldn't delete lead — check permissions",
      )
    } finally {
      setDeletingId(null)
    }
  }

  async function handleInlineIndustry(merchant: Merchant, next: string) {
    // Changing industry clears the subcategory — it belonged to the old
    // industry and may not exist under the new one (matches the Add/Detail
    // modals).
    try {
      await updateMerchant(merchant.id, { industry: next, subcategory: '' })
      mutateMerchants((prev) =>
        prev.map((m) =>
          m.id === merchant.id ? { ...m, industry: next, subcategory: '' } : m,
        ),
      )
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : "Couldn't update industry",
      )
    }
  }

  async function handleInlineSubcategory(merchant: Merchant, next: string) {
    try {
      await updateMerchant(merchant.id, { subcategory: next })
      mutateMerchants((prev) =>
        prev.map((m) =>
          m.id === merchant.id ? { ...m, subcategory: next } : m,
        ),
      )
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : "Couldn't update subcategory",
      )
    }
  }

  async function handleInlineReassign(merchant: Merchant, newRepId: string) {
    const ds = dealsByMerchant.get(merchant.id) ?? []
    if (ds.length !== 1) return // safety
    const d = ds[0]
    if (d.repId === newRepId) return
    const newRep = users.find((u) => u.id === newRepId)
    try {
      await reassignDeal({
        deal: d,
        newRepId,
        byUserId: me.id,
        byUserName: me.name,
        newRepName: newRep?.name ?? 'someone',
      })
      toast.show(
        `${merchant.name} reassigned to ${newRep?.name ?? 'rep'} · they were notified`,
      )
    } catch (err) {
      toast.show(
        err instanceof Error
          ? err.message
          : "Couldn't reassign — check permissions",
      )
    }
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id))
  const someVisibleSelected =
    !allVisibleSelected && filtered.some((m) => selected.has(m.id))

  return (
    <>
      <DateRangeBar />

      <div className="flex flex-wrap items-center gap-2.5">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(draftQ.trim())
          }}
        >
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              type="search"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraftQ('')
                  setQ('')
                }
              }}
              placeholder="Type a name, press Enter…"
              aria-label="Search leads"
              className="w-[260px] rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 pl-8 text-[13px] outline-none transition-colors focus:border-major"
            />
          </div>
          <Button type="submit" size="sm">
            Search
          </Button>
          {draftQ.trim() !== q && (
            <span className="text-[11px] italic text-ink-3">
              press Enter ↵
            </span>
          )}
        </form>

        <select
          value={industry}
          onChange={(e) => {
            // Switching industry invalidates the subcategory — it belonged to
            // the old industry and may not exist under the new one.
            setIndustry(e.target.value)
            setSubcategory('')
          }}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="">All Industries</option>
          {industries.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>

        {/* Subcategory filter — only meaningful once an industry is picked, and
            only when that industry actually has subcategories. */}
        {industry && subcategoriesFor(industry).length > 0 && (
          <select
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
          >
            <option value="">All Subcategories</option>
            {subcategoriesFor(industry).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}

        <select
          value={projectFilterId}
          onChange={(e) => setProjectFilterId(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="">All Statuses</option>
          <option value={NO_DEALS_STATUS}>No deals</option>
          {orderedStages.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-ink-3">Export:</span>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={12} /> Add Lead
          </Button>
        </div>
      </div>

      {selectedVisible.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-major bg-major-light/40 px-4 py-2.5">
          <span className="text-[13px] font-semibold text-major">
            {selectedVisible.length} lead
            {selectedVisible.length === 1 ? '' : 's'} selected
          </span>
          <button
            onClick={clearSelection}
            className="text-[12px] font-medium text-ink-2 underline-offset-2 hover:underline"
          >
            clear
          </button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              <FolderPlus size={12} /> Add to project
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div
          role="row"
          className="grid items-center gap-0 border-b-2 border-line bg-ghost"
          style={{
            gridTemplateColumns: canDelete
              ? GRID_COLS_WITH_DELETE
              : GRID_COLS_BASE,
          }}
        >
          <div className="px-3 py-2.5">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleSelected
              }}
              onChange={toggleAllVisible}
              aria-label="Select all visible"
              className="h-4 w-4 cursor-pointer accent-major"
            />
          </div>
          {[
            'Lead',
            'Industry',
            'Subcategory',
            'Contact',
            'Phone',
            'Projects',
            'Owner(s)',
            'Status',
          ].map((h) => (
            <div
              key={h}
              role="columnheader"
              className="px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 whitespace-nowrap"
            >
              {h}
            </div>
          ))}
          {canDelete && <div aria-label="Actions" />}
        </div>

        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-[13px] italic text-ink-3">
            {merchantsLoading
              ? 'Loading leads…'
              : merchants.length === 0
                ? 'No leads match the current search/industry filter.'
                : 'No matches in the loaded pages — try Load more or clear client-side filters.'}
          </div>
        ) : (
          <FixedSizeList
            height={Math.min(filtered.length * ROW_HEIGHT, LIST_MAX_HEIGHT)}
            itemCount={filtered.length}
            itemSize={ROW_HEIGHT}
            width="100%"
            // Pass everything the row needs via itemData so memoized rows
            // can skip re-renders when unrelated state changes.
            itemData={{
              filtered,
              dealsByMerchant,
              users,
              projects,
              stages,
              selected,
              canDelete,
              canManageOwners,
              deletingId,
              gridTemplate: canDelete
                ? GRID_COLS_WITH_DELETE
                : GRID_COLS_BASE,
              mostAdvancedStatus,
              setDetailId,
              toggleOne,
              industries,
              subcategoriesFor,
              handleInlineIndustry,
              handleInlineSubcategory,
              handleInlineReassign,
              handleDelete,
              setReassignMerchant,
            }}
          >
            {MerchantRow}
          </FixedSizeList>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line bg-ghost/50 px-4 py-2.5 text-[12px] text-ink-3">
          <span>
            Showing {filtered.length} of {merchants.length} loaded
            {clientFiltersActive && (
              <span className="ml-1 italic text-ink-4">
                · project/status/date filter only the loaded pages
              </span>
            )}
          </span>
          {hasMore ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : (
            <span className="italic text-ink-4">
              {merchants.length > 0 ? 'End of list' : ''}
            </span>
          )}
        </div>
      </div>

      <AddMerchantModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          setDetailId(id)
          // New merchant may not fit the active filter; refetch from the top
          // so the user sees a coherent list.
          reloadMerchants()
        }}
      />

      <MerchantDetailModal
        merchantId={detailId}
        onClose={() => setDetailId(null)}
        projects={projects}
        stages={stages}
        users={users}
        merchants={merchants}
      />

      <BulkAddToProjectModal
        open={bulkOpen}
        onClose={() => {
          setBulkOpen(false)
          // Keep selection so user can run it again if they want; uncomment
          // the next line to auto-clear:
          // setSelected(new Set())
        }}
        selectedMerchants={selectedMerchants}
        deals={deals}
        projects={projects}
        stages={stages}
        users={users}
      />

      <ReassignMerchantDealsModal
        merchant={reassignMerchant}
        deals={deals}
        onClose={() => setReassignMerchant(null)}
        projects={projects}
        stages={stages}
        users={users}
      />
    </>
  )
}

// Inline subcategory editor for a merchant row. Subcategories belong to an
// industry, so the options are the selected industry's children. When the
// industry has none, there's nothing to assign — show a muted dash (mirrors
// the Add/Detail modals, which hide the dropdown entirely in that case).
function SubcategoryCell({
  merchant,
  options,
  onChange,
}: {
  merchant: Merchant
  options: string[]
  onChange: (next: string) => void
}) {
  if (options.length === 0) {
    return (
      <div
        className="min-w-0 overflow-hidden px-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[12px] italic text-ink-4">—</span>
      </div>
    )
  }
  return (
    <div
      className="min-w-0 overflow-hidden px-3 text-[12px] text-ink-2"
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={merchant.subcategory ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Set subcategory for ${merchant.name}`}
        title={`Set subcategory for ${merchant.name}`}
        className="w-full max-w-full cursor-pointer truncate rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[12px] outline-none hover:border-line focus:border-major focus:bg-white"
      >
        <option value="">—</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  )
}

interface OwnerCellProps {
  merchant: Merchant
  deals: Deal[]
  users: User[]
  ownerNames: string[]
  canManage: boolean
  onInlineReassign: (newRepId: string) => void
  onOpenMultiReassign: () => void
}

function OwnerCell({
  merchant,
  deals,
  users,
  ownerNames,
  canManage,
  onInlineReassign,
  onOpenMultiReassign,
}: OwnerCellProps) {
  // No deals → show dash.
  if (deals.length === 0) {
    return <span className="text-[12px] italic text-ink-4">—</span>
  }

  // Read-only display for non-Admin/Head.
  if (!canManage) {
    return (
      <span className="text-[12px] text-ink-2">
        {ownerNames.join(', ') || '—'}
      </span>
    )
  }

  // 1 deal → inline select.
  if (deals.length === 1) {
    const d = deals[0]
    return (
      <select
        value={d.repId}
        onChange={(e) => onInlineReassign(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[12px] outline-none focus:border-major"
        title={`Reassign ${merchant.name}`}
      >
        {users
          .filter((u) => !u.disabled)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
      </select>
    )
  }

  // Multiple deals → names + Reassign… button that opens the per-deal modal.
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink-2">{ownerNames.join(', ')}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onOpenMultiReassign()
        }}
        className="rounded-md border border-line bg-white px-2 py-px text-[11px] font-semibold text-ink-2 transition-colors hover:border-major hover:text-major"
      >
        Reassign…
      </button>
    </div>
  )
}

// ─── Virtualized row ────────────────────────────────────────────────────────

interface RowData {
  filtered: Merchant[]
  dealsByMerchant: Map<string, Deal[]>
  users: User[]
  projects: Project[]
  stages: Stage[]
  selected: Set<string>
  canDelete: boolean
  canManageOwners: boolean
  deletingId: string | null
  gridTemplate: string
  mostAdvancedStatus: (deals: Deal[]) => string | null
  setDetailId: (id: string) => void
  toggleOne: (id: string) => void
  industries: string[]
  subcategoriesFor: (industry: string) => string[]
  handleInlineIndustry: (m: Merchant, next: string) => void
  handleInlineSubcategory: (m: Merchant, next: string) => void
  handleInlineReassign: (m: Merchant, newRepId: string) => void
  handleDelete: (m: Merchant) => void
  setReassignMerchant: (m: Merchant | null) => void
}

const MerchantRow = memo(function MerchantRow({
  index,
  style,
  data,
}: ListChildComponentProps<RowData>) {
  const m = data.filtered[index]
  const ds = data.dealsByMerchant.get(m.id) ?? []
  const projIds = [...new Set(ds.map((d) => d.projectId))]
  const ownerNames = [
    ...new Set(
      ds
        .map((d) => data.users.find((u) => u.id === d.repId)?.name)
        .filter((n): n is string => !!n),
    ),
  ]
  const best = data.mostAdvancedStatus(ds)
  const isSelected = data.selected.has(m.id)
  // react-window positions rows absolutely via the `style` prop; we layer
  // our own grid columns on top of it without disturbing top/height.
  const rowStyle: CSSProperties = {
    ...style,
    gridTemplateColumns: data.gridTemplate,
  }
  return (
    <div
      role="row"
      style={rowStyle}
      className={clsx(
        'grid items-center border-b border-line hover:bg-[#f8f8fd]',
        isSelected && 'bg-major-light/40',
      )}
    >
      <div className="px-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => data.toggleOne(m.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${m.name}`}
          className="h-4 w-4 cursor-pointer accent-major"
        />
      </div>
      <div
        className="cursor-pointer truncate px-3 font-semibold"
        onClick={() => data.setDetailId(m.id)}
        title={m.name}
      >
        {m.name}
      </div>
      <div
        className="min-w-0 overflow-hidden px-3 text-[12px] text-ink-2"
        onClick={(e) => e.stopPropagation()}
      >
        <select
          value={m.industry ?? ''}
          onChange={(e) => data.handleInlineIndustry(m, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Set industry for ${m.name}`}
          title={`Set industry for ${m.name}`}
          className="w-full max-w-full cursor-pointer truncate rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[12px] outline-none hover:border-line focus:border-major focus:bg-white"
        >
          <option value="">—</option>
          {data.industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
      <SubcategoryCell
        merchant={m}
        options={data.subcategoriesFor(m.industry ?? '')}
        onChange={(next) => data.handleInlineSubcategory(m, next)}
      />
      <div
        className="cursor-pointer truncate px-3"
        onClick={() => data.setDetailId(m.id)}
        title={m.contact || ''}
      >
        {m.contact || '—'}
      </div>
      <div
        className="font-mono-num cursor-pointer truncate px-3 text-[12px]"
        onClick={() => data.setDetailId(m.id)}
        title={m.phone || ''}
      >
        {m.phone || '—'}
      </div>
      <div
        className="cursor-pointer overflow-hidden px-3"
        onClick={() => data.setDetailId(m.id)}
      >
        <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
          {projIds.length === 0 ? (
            <span className="text-[12px] italic text-ink-4">none</span>
          ) : (
            projIds.map((pid) => (
              <ProjectBadge
                key={pid}
                projectId={pid}
                projects={data.projects}
              />
            ))
          )}
        </div>
      </div>
      <div
        className="overflow-hidden px-3"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerCell
          merchant={m}
          deals={ds}
          users={data.users}
          ownerNames={ownerNames}
          canManage={data.canManageOwners}
          onInlineReassign={(newRepId) =>
            data.handleInlineReassign(m, newRepId)
          }
          onOpenMultiReassign={() => data.setReassignMerchant(m)}
        />
      </div>
      <div
        className="cursor-pointer px-3"
        onClick={() => data.setDetailId(m.id)}
      >
        {best ? (
          <StatusBadge status={best} stages={data.stages} />
        ) : (
          <span className="text-[12px] italic text-ink-4">—</span>
        )}
      </div>
      {data.canDelete && (
        <div className="px-3" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => data.handleDelete(m)}
            disabled={data.deletingId === m.id}
            aria-label={`Delete ${m.name}`}
            title={`Delete ${m.name}`}
            className="cursor-pointer rounded-md border border-transparent p-1.5 text-ink-3 transition-colors hover:border-line hover:bg-white hover:text-[#d63c2e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
})

