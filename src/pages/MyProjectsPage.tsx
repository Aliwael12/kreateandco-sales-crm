import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Trash2, Plus, ArrowLeft, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'
import { useProfile, canSeeAll, isAdmin, isHead } from '@/context/auth'
import { useDateRange } from '@/context/date-range'
import DateRangeBar from '@/components/ui/DateRangeBar'
import { useCollection } from '@/hooks/useCollection'
import { useScopedDeals } from '@/hooks/useScopedCollections'
import { useMerchantsByIds } from '@/hooks/useMerchantsByIds'
import { useIndustries } from '@/hooks/useIndustries'
import {
  COL,
  type Deal,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'
import EditableCell from '@/components/sheet/EditableCell'
import StatusSelect from '@/components/sheet/StatusSelect'
import ProjectsOverviewGrid from '@/components/sheet/ProjectsOverviewGrid'
import {
  createDeal,
  createReminder,
  deleteDeal,
  logActivity,
  updateDealField,
  updateDealFields,
  updateMerchant,
  upsertMerchantByNameQuery,
} from '@/lib/data'
import { useToast } from '@/components/ui/toast-context'
import clsx from 'clsx'

const REMINDER_OFFSETS_MS: Record<string, number> = {
  'Missed Call': 3 * 60 * 60 * 1000,
  'Follow Up': 2 * 24 * 60 * 60 * 1000,
}

export default function MyProjectsPage() {
  const me = useProfile()
  const toast = useToast()
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: stages } = useCollection<Stage>(COL.stages)
  const { data: users } = useCollection<User>(COL.users)
  const { data: allDeals } = useScopedDeals()
  // Fetch only the merchants referenced by this rep's deals, not the whole
  // (thousands-strong) collection. ids derive from the deals already loaded.
  const merchantIds = useMemo(
    () => allDeals.map((d) => d.merchantId).filter(Boolean),
    [allDeals],
  )
  const { merchantsById, refresh: refreshMerchants } =
    useMerchantsByIds(merchantIds)
  const { inRange } = useDateRange()
  const { names: industries } = useIndustries()

  const adminView = isAdmin(me.role)
  // Admins and Heads get the shared date-range filter (same control as
  // Pipeline / Dashboard), narrowing deals by when they were created. Reps
  // and interns don't see the bar, so their deals are never date-filtered.
  const showDateRange = isAdmin(me.role) || isHead(me.role)

  const rangedDeals = useMemo(() => {
    if (!showDateRange) return allDeals
    return allDeals.filter((d) => {
      const ms = d.createdAt?.toMillis?.()
      // A freshly added row's serverTimestamp reads back as null for a beat;
      // keep it visible (it sorts to the bottom) instead of flickering out.
      if (ms == null) return true
      return inRange(ms)
    })
  }, [allDeals, showDateRange, inRange])

  // Admins see EVERY project regardless of their own projectIds. Other
  // roles only see projects they're assigned to.
  const myProjects = useMemo(
    () =>
      adminView
        ? projects
        : projects.filter((p) => me.projectIds.includes(p.id)),
    [adminView, projects, me.projectIds],
  )

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [empFilter, setEmpFilter] = useState<string>('all')
  // Sheet view: filter the open project's rows by deal status (stage).
  // 'all' shows every row.
  const [statusFilter, setStatusFilter] = useState('all')
  // Which set of projects the pills show: in-progress (default) or completed.
  const [projectView, setProjectView] = useState<'active' | 'completed'>(
    'active',
  )
  // Heavy sheet mounts (1000+ rows) keep the click responsive while React
  // does the work in the background — Stamps / Rabbit-sized projects used
  // to freeze the tab for several seconds.
  const [isPending, startTransition] = useTransition()

  // The pills (and the non-admin default selection) only show the projects
  // matching the active In progress / Completed view.
  const visibleProjects = useMemo(
    () =>
      myProjects.filter((p) =>
        projectView === 'completed' ? p.completed : !p.completed,
      ),
    [myProjects, projectView],
  )
  const completedCount = useMemo(
    () => myProjects.filter((p) => p.completed).length,
    [myProjects],
  )

  function pickProject(id: string | null) {
    startTransition(() => {
      setCurrentProjectId(id)
      setEmpFilter('all')
    })
  }

  function switchView(view: 'active' | 'completed') {
    // Switching the view can hide the currently open project — drop back to the
    // list/overview so the sheet never shows a project that's not in the view.
    setProjectView(view)
    pickProject(null)
  }

  // For admins, the default view is the overview grid (no project picked).
  // For everyone else, the first project in the current view is the default.
  const activeProjectId = adminView
    ? currentProjectId
    : (currentProjectId ?? visibleProjects[0]?.id ?? null)

  const seeAll = canSeeAll(me.role)

  const dealsInProject = useMemo(
    () => rangedDeals.filter((d) => d.projectId === activeProjectId),
    [rangedDeals, activeProjectId],
  )

  const repsInProject = useMemo(() => {
    const set = new Set(dealsInProject.map((d) => d.repId))
    return users.filter((u) => set.has(u.id))
  }, [dealsInProject, users])

  const visibleDeals = useMemo(() => {
    const byRep = !seeAll
      ? dealsInProject.filter((d) => d.repId === me.id)
      : empFilter === 'all'
        ? dealsInProject
        : dealsInProject.filter((d) => d.repId === empFilter)
    const filtered =
      statusFilter === 'all'
        ? byRep
        : byRep.filter((d) => d.status === statusFilter)
    // Oldest first so a freshly added row always lands at the bottom. The
    // deals listener has no orderBy, so Firestore returns docs in
    // document-ID order (effectively random for auto-generated IDs) — that's
    // why new rows used to appear in the middle of the sheet. A pending
    // serverTimestamp reads back as null until the server resolves it, so we
    // treat a missing createdAt as +∞: the new row sits at the very bottom
    // immediately and stays there once the real timestamp lands.
    return filtered.slice().sort((a, b) => {
      const am = a.createdAt?.toMillis?.() ?? Infinity
      const bm = b.createdAt?.toMillis?.() ?? Infinity
      return am - bm
    })
  }, [dealsInProject, seeAll, empFilter, statusFilter, me.id])

  // Row lookups use the by-id map from useMerchantsByIds (keyed by merchant id),
  // which only contains the merchants referenced by the loaded deals.
  const merchantById = merchantsById

  const userById = useMemo(() => {
    const map = new Map<string, User>()
    for (const u of users) map.set(u.id, u)
    return map
  }, [users])

  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  const defaultStatus = orderedStages[0]?.name ?? 'Initial Contact'

  const canEditRow = (d: Deal) => isAdmin(me.role) || d.repId === me.id
  const showRepCol = seeAll && empFilter === 'all'

  // ── pagination ────────────────────────────────────────────────────
  // 50 rows per page keeps even Rabbit/Stamps-sized projects snappy — only
  // a single page of rows is ever mounted, so switching projects/filters
  // never has to commit a 1000-row sheet.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  const totalDeals = visibleDeals.length
  const pageCount = Math.max(1, Math.ceil(totalDeals / PAGE_SIZE))

  const renderKey = `${activeProjectId ?? ''}|${empFilter}|${statusFilter}|${seeAll ? 1 : 0}`
  const [prevRenderKey, setPrevRenderKey] = useState(renderKey)
  if (prevRenderKey !== renderKey) {
    // Switching projects / filters: jump back to the first page in-render
    // (React's documented pattern for resetting state on prop change).
    setPrevRenderKey(renderKey)
    setPage(0)
  }
  // Clamp without storing a stale value: if rows were deleted off the end,
  // `page` may exceed the range. Derive the page we actually show and base
  // the prev/next handlers on it so the stale value self-heals on the next
  // click.
  const safePage = Math.min(page, pageCount - 1)
  const visibleSlice = useMemo(
    () =>
      visibleDeals.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [visibleDeals, safePage],
  )

  async function handleAddRow() {
    if (!activeProjectId) return
    await createDeal({
      projectId: activeProjectId,
      repId: me.id,
      createdBy: me.id,
      defaultStatus,
    })
    if (seeAll) setEmpFilter(me.id)
  }

  async function handleMerchantNameCommit(deal: Deal, newName: string) {
    const merchantId = newName
      ? await upsertMerchantByNameQuery(newName, me.id)
      : ''
    await updateDealFields(
      deal.id,
      { merchantName: newName, merchantId },
      me.id,
    )
    // Pull the (possibly newly-created) merchant into the by-id map so the row
    // shows its industry/contact fields without loading the whole collection.
    refreshMerchants()
  }

  async function handleStatusChange(deal: Deal, newStatus: string) {
    if (deal.status === newStatus) return
    await updateDealField(deal.id, 'status', newStatus, me.id)
    await logActivity({
      who: me.id,
      whoName: me.name,
      kind: 'deal.status',
      text: `${deal.merchantName || 'New deal'} → ${newStatus}`,
      refId: deal.id,
      refKind: 'deal',
    })

    const offset = REMINDER_OFFSETS_MS[newStatus]
    if (offset && deal.merchantName) {
      await createReminder({
        dealId: deal.id,
        merchantId: deal.merchantId,
        merchantName: deal.merchantName,
        projectId: deal.projectId,
        repId: deal.repId,
        type: newStatus === 'Missed Call' ? 'missed' : 'followup',
        note: `Auto-created when status changed to ${newStatus}`,
        dueAt: new Date(Date.now() + offset),
      })
      toast.show(`Status updated · Reminder created`)
    } else {
      toast.show('Status updated')
    }
  }

  async function handleDelete(d: Deal) {
    if (!window.confirm('Delete this row? This cannot be undone.')) return
    await deleteDeal(d.id)
    if (d.merchantName) {
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'deal.delete',
        text: `deleted ${d.merchantName} from project`,
        refId: d.id,
        refKind: 'deal',
      })
    }
    toast.show('Row deleted')
  }

  if (myProjects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-2xl border border-line bg-white p-10 text-center">
          <div className="font-display mb-2 text-[20px] font-bold text-ink-1">
            No projects assigned
          </div>
          <p className="text-[13px] text-ink-3">
            You haven’t been added to any projects yet. Ask an admin to assign
            you in the Admin page.
          </p>
        </div>
      </div>
    )
  }

  // Admin overview: show the all-projects grid until a project is picked.
  if (adminView && !activeProjectId) {
    return (
      <>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[18px] font-bold text-ink-1">
              {projectView === 'completed' ? 'Completed Projects' : 'All Projects'}
            </div>
            <div className="text-[12px] text-ink-3">
              {visibleProjects.length} project
              {visibleProjects.length === 1 ? '' : 's'} · click a card to see its
              leads
            </div>
          </div>
        </div>
        <DateRangeBar />

        {/* In progress / Completed switch (admin overview). */}
        {(completedCount > 0 || projectView === 'completed') && (
          <div className="flex gap-2">
            <button
              onClick={() => switchView('active')}
              className={clsx(
                'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors',
                projectView === 'active'
                  ? 'border-major bg-major text-white'
                  : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
              )}
            >
              In progress
            </button>
            <button
              onClick={() => switchView('completed')}
              className={clsx(
                'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors',
                projectView === 'completed'
                  ? 'border-major bg-major text-white'
                  : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
              )}
            >
              Completed ({completedCount})
            </button>
          </div>
        )}

        {visibleProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-white px-4 py-10 text-center text-[13px] italic text-ink-3">
            {projectView === 'completed'
              ? 'No completed projects yet. Mark one complete from the Admin page.'
              : 'No projects in progress.'}
          </div>
        ) : (
          <ProjectsOverviewGrid
            projects={visibleProjects}
            stages={stages}
            deals={rangedDeals}
            users={users}
            onPickProject={pickProject}
          />
        )}
      </>
    )
  }

  return (
    <>
      {adminView && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => pickProject(null)}
            className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-major hover:text-major"
          >
            <ArrowLeft size={13} /> All Projects
          </button>
          {myProjects.find((p) => p.id === activeProjectId) && (
            <span className="font-display text-[16px] font-bold text-ink-1">
              {myProjects.find((p) => p.id === activeProjectId)?.name}
            </span>
          )}
          {isPending && (
            <span className="text-[11.5px] italic text-ink-3">Loading…</span>
          )}
        </div>
      )}
      {showDateRange && <DateRangeBar />}

      {/* In progress / Completed switch. Hidden until something is completed
          (or while viewing completed) so the row stays clean by default. */}
      {(completedCount > 0 || projectView === 'completed') && (
        <div className="flex gap-2">
          <button
            onClick={() => switchView('active')}
            className={clsx(
              'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors',
              projectView === 'active'
                ? 'border-major bg-major text-white'
                : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
            )}
          >
            In progress
          </button>
          <button
            onClick={() => switchView('completed')}
            className={clsx(
              'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors',
              projectView === 'completed'
                ? 'border-major bg-major text-white'
                : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
            )}
          >
            Completed ({completedCount})
          </button>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <div className="flex flex-wrap gap-2">
          {visibleProjects.length === 0 ? (
            <span className="py-1.5 text-[12.5px] italic text-ink-3">
              {projectView === 'completed'
                ? 'No completed projects yet.'
                : 'No projects in progress.'}
            </span>
          ) : (
            visibleProjects.map((p) => {
              const active = p.id === activeProjectId
              return (
                <button
                  key={p.id}
                  onClick={() => pickProject(p.id)}
                  className={clsx(
                    'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors',
                    active
                      ? 'border-major bg-major text-white'
                      : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
                  )}
                >
                  {p.name}
                </button>
              )
            })
          )}
        </div>
        <div className="ml-auto">
          <button
            onClick={handleAddRow}
            className="flex items-center gap-1.5 rounded-lg bg-major px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#4a3fb8]"
          >
            <Plus size={13} /> Add Row
          </button>
        </div>
      </div>

      {seeAll && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Filter by rep:
          </span>
          <FilterPill
            label="All reps"
            active={empFilter === 'all'}
            onClick={() => setEmpFilter('all')}
          />
          {repsInProject.map((u) => (
            <FilterPill
              key={u.id}
              label={u.name}
              color={u.color}
              active={empFilter === u.id}
              onClick={() => setEmpFilter(u.id)}
            />
          ))}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="ml-auto cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
          >
            <option value="all">All statuses</option>
            {orderedStages.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="sheet-scroll overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[1600px] border-collapse">
          <thead>
            <tr>
              <Th width={36}>#</Th>
              <Th minWidth={170}>Lead *</Th>
              <Th minWidth={140}>Industry</Th>
              <Th minWidth={140}>Contact Name</Th>
              <Th minWidth={120}>Role / Title</Th>
              <Th minWidth={150}>Phone</Th>
              <Th minWidth={170}>Status</Th>
              <Th minWidth={160}>Proposed Take Rate</Th>
              <Th minWidth={220}>Comments</Th>
              {showRepCol && <Th minWidth={100}>Rep</Th>}
              <Th minWidth={110}>Date Added</Th>
              <Th minWidth={110}>Last Edited</Th>
              <Th width={44} />
            </tr>
          </thead>
          <tbody>
            {visibleSlice.map((d, i) => {
              const rep = userById.get(d.repId)
              const editable = canEditRow(d)
              const merchant = d.merchantId
                ? merchantById.get(d.merchantId) ?? null
                : null
              return (
                <tr
                  key={d.id}
                  className="border-b border-line last:border-0 hover:bg-[#fafafe]"
                >
                  <td>
                    <div className="px-2.5 text-center text-[11px] text-ink-4">
                      {safePage * PAGE_SIZE + i + 1}
                    </div>
                  </td>
                  <td>
                    <EditableCell
                      value={d.merchantName}
                      placeholder="Business name…"
                      readOnly={!editable}
                      onCommit={(v) => handleMerchantNameCommit(d, v)}
                    />
                  </td>
                  <td>
                    {!editable || !merchant ? (
                      <div
                        className={clsx(
                          'flex min-h-[42px] items-center px-3.5 py-2.5 text-[13px]',
                          !merchant?.industry && 'italic text-ink-4',
                        )}
                      >
                        {merchant?.industry ||
                          (merchant ? '—' : '— add lead first —')}
                      </div>
                    ) : (
                      <select
                        value={merchant.industry ?? ''}
                        onChange={async (e) => {
                          const next = e.target.value
                          try {
                            await updateMerchant(merchant.id, { industry: next })
                            refreshMerchants()
                          } catch (err) {
                            toast.show(
                              err instanceof Error
                                ? err.message
                                : "Couldn't update industry",
                            )
                          }
                        }}
                        aria-label="Set industry"
                        title="Set industry"
                        className="min-h-[42px] w-full cursor-pointer border-0 bg-transparent px-3.5 py-2.5 text-[13px] outline-none focus:bg-major-light focus:shadow-[inset_0_0_0_2px_var(--color-major)]"
                      >
                        <option value="">—</option>
                        {industries.map((ind) => (
                          <option key={ind} value={ind}>
                            {ind}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <EditableCell
                      value={merchant?.contact ?? ''}
                      placeholder={merchant ? 'Contact name…' : '— add lead first —'}
                      readOnly={!editable || !merchant}
                      onCommit={async (v) => {
                        if (merchant) {
                          await updateMerchant(merchant.id, { contact: v })
                          refreshMerchants()
                        }
                      }}
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={merchant?.contactRole ?? ''}
                      placeholder={merchant ? 'e.g. Owner / Manager' : '—'}
                      readOnly={!editable || !merchant}
                      onCommit={async (v) => {
                        if (merchant) {
                          await updateMerchant(merchant.id, { contactRole: v })
                          refreshMerchants()
                        }
                      }}
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={merchant?.phone ?? ''}
                      placeholder={merchant ? '+20 1X XXXX XXXX' : '—'}
                      readOnly={!editable || !merchant}
                      mono
                      onCommit={async (v) => {
                        if (merchant) {
                          await updateMerchant(merchant.id, { phone: v })
                          refreshMerchants()
                        }
                      }}
                    />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <StatusSelect
                      value={d.status}
                      stages={orderedStages}
                      disabled={!editable}
                      onChange={(v) => handleStatusChange(d, v)}
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={d.rate}
                      placeholder="e.g. 10% rev share…"
                      readOnly={!editable}
                      onCommit={(v) => updateDealField(d.id, 'rate', v, me.id)}
                    />
                  </td>
                  <td className="align-top">
                    <EditableCell
                      value={d.comments}
                      placeholder="Add comments…"
                      readOnly={!editable}
                      multiline
                      onCommit={(v) =>
                        updateDealField(d.id, 'comments', v, me.id)
                      }
                    />
                  </td>
                  {showRepCol && (
                    <td>
                      <div
                        className="px-3.5 py-2.5 text-[12px] font-semibold"
                        style={{ color: rep?.color ?? 'var(--color-major)' }}
                      >
                        {rep?.name ?? '—'}
                      </div>
                    </td>
                  )}
                  <td>
                    <div className="font-mono-num px-3.5 py-2.5 text-[11.5px] text-ink-3">
                      {fmtDate(d.createdAt)}
                    </div>
                  </td>
                  <td>
                    <div className="font-mono-num px-3.5 py-2.5 text-[11.5px] text-ink-3">
                      {fmtDate(d.updatedAt)}
                    </div>
                  </td>
                  <td>
                    {editable ? (
                      <button
                        onClick={() => handleDelete(d)}
                        title="Delete row"
                        className="mx-1.5 flex h-8 w-8 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-bad-light hover:text-bad"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <div className="w-11" />
                    )}
                  </td>
                </tr>
              )
            })}
            {visibleDeals.length === 0 && (
              <tr>
                <td
                  colSpan={showRepCol ? 13 : 12}
                  className="px-4 py-10 text-center text-[13px] italic text-ink-3"
                >
                  {statusFilter !== 'all' || empFilter !== 'all' ? (
                    'No deals match the current filter.'
                  ) : (
                    <>
                      No rows yet. Click <b>Add Row</b> to add a lead to
                      this project.
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <button
          onClick={handleAddRow}
          className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-[13px] text-ink-3 transition-colors hover:bg-[#fafafe] hover:text-major"
        >
          <Plus size={14} /> Add lead row
        </button>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 py-1">
          <button
            type="button"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-major hover:text-major disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[12.5px] text-ink-3">
            Page {safePage + 1} of {pageCount}
            <span className="mx-1.5 text-ink-4">·</span>
            {totalDeals} {totalDeals === 1 ? 'row' : 'rows'}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-major hover:text-major disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <ScrollToBottomFab />
    </>
  )
}

// Walk up from `el` to the first ancestor that scrolls vertically — here the
// AppShell content pane (`overflow-y-auto`). Matches the overflow style rather
// than the current overflow amount so it's found even before the sheet is long
// enough to overflow.
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node
    node = node.parentElement
  }
  return null
}

// Floating "jump to bottom" affordance for the (often long) project sheet.
// Appears once the user has scrolled down and there's still content below;
// clicking it smooth-scrolls the page's scroll container to the very bottom.
function ScrollToBottomFab() {
  const anchorRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const scroller = getScrollParent(anchorRef.current)
    scrollerRef.current = scroller
    if (!scroller) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller
      const distanceToBottom = scrollHeight - clientHeight - scrollTop
      // Show after a little scrolling, and hide once we're basically there.
      setShow(scrollTop > 160 && distanceToBottom > 160)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const toBottom = () => {
    const s = scrollerRef.current
    if (s) s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' })
  }

  return (
    <>
      <div
        ref={anchorRef}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0"
      />
      {show && (
        <button
          type="button"
          onClick={toBottom}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          className="fixed bottom-6 right-6 z-30 flex items-center gap-1.5 rounded-full border border-line bg-white px-4 py-2.5 text-[12.5px] font-semibold text-ink-2 shadow-[0_4px_16px_rgba(20,20,50,.16)] transition-colors hover:border-major hover:text-major"
        >
          <ChevronDown size={15} />
          Jump to bottom
        </button>
      )}
    </>
  )
}

function Th({
  children,
  width,
  minWidth,
}: {
  children?: React.ReactNode
  width?: number
  minWidth?: number
}) {
  return (
    <th
      style={{ width, minWidth }}
      className="border-b-2 border-line bg-[#f8f8fd] px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-ink-3 whitespace-nowrap"
    >
      {children}
    </th>
  )
}

function FilterPill({
  label,
  active,
  color,
  onClick,
}: {
  label: string
  active: boolean
  color?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-lg border-[1.5px] bg-white px-3 py-1 text-[12.5px] font-semibold transition-colors',
        active
          ? 'border-major text-major'
          : 'border-line text-ink-2 hover:border-major hover:text-major',
      )}
    >
      {color && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ background: color }}
        >
          {label[0]?.toUpperCase()}
        </span>
      )}
      {label}
    </button>
  )
}

function fmtDate(ts: { toDate(): Date } | undefined | null): string {
  if (!ts || typeof ts.toDate !== 'function') return '—'
  return format(ts.toDate(), 'yyyy-MM-dd')
}
