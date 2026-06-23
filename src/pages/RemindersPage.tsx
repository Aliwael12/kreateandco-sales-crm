import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check } from 'lucide-react'
import { format, isAfter } from 'date-fns'
import { useProfile, canSeeAll, isAdmin } from '@/context/auth'
import { useCollection } from '@/hooks/useCollection'
import {
  useScopedDeals,
  useScopedReminders,
  useScopedTasks,
} from '@/hooks/useScopedCollections'
import {
  COL,
  type Reminder,
  type Project,
  type Stage,
  type TaskStatus,
  type User,
} from '@/lib/types'
import StatusBadge, { ProjectBadge } from '@/components/ui/StatusBadge'
import ReminderDetailModal from '@/components/reminders/ReminderDetailModal'
import { dismissReminder } from '@/lib/data'
import { useToast } from '@/components/ui/toast-context'
import clsx from 'clsx'

type Filter = 'all' | 'followup' | 'missed' | 'manual' | 'assignment'

export default function RemindersPage() {
  const me = useProfile()
  const toast = useToast()
  const { data: allReminders } = useScopedReminders()
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: stages } = useCollection<Stage>(COL.stages)
  const { data: users } = useCollection<User>(COL.users)
  const { data: deals } = useScopedDeals()

  const [filter, setFilter] = useState<Filter>('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [repFilter, setRepFilter] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const seeAll = canSeeAll(me.role)
  const admin = isAdmin(me.role)

  // Mirrors firestore.rules: only Admin or the reminder's owner rep can
  // dismiss it. Sales Head / BD can read everyone's reminders but the
  // checkbox stays disabled for ones they don't own.
  const canDismiss = (r: Reminder) => admin || r.repId === me.id

  const visible = useMemo(() => {
    return allReminders
      .filter((r) => !r.dismissed)
      .filter((r) => (seeAll ? true : r.repId === me.id))
      .filter((r) =>
        seeAll && projectFilter !== 'all' ? r.projectId === projectFilter : true,
      )
      .filter((r) =>
        seeAll && repFilter !== 'all' ? r.repId === repFilter : true,
      )
      .filter((r) => (filter === 'all' ? true : r.type === filter))
      .sort((a, b) => {
        const aMs = a.dueAt?.toMillis?.() ?? 0
        const bMs = b.dueAt?.toMillis?.() ?? 0
        return aMs - bMs
      })
  }, [allReminders, seeAll, me.id, filter, projectFilter, repFilter])

  const counts = useMemo(() => {
    const own = allReminders.filter(
      (r) =>
        !r.dismissed &&
        (seeAll || r.repId === me.id) &&
        (!seeAll || projectFilter === 'all' || r.projectId === projectFilter) &&
        (!seeAll || repFilter === 'all' || r.repId === repFilter),
    )
    return {
      all: own.length,
      followup: own.filter((r) => r.type === 'followup').length,
      missed: own.filter((r) => r.type === 'missed').length,
      manual: own.filter((r) => r.type === 'manual').length,
      assignment: own.filter((r) => r.type === 'assignment').length,
    }
  }, [allReminders, me.id, seeAll, projectFilter, repFilter])

  // Only count selections that are still visible & still dismissable —
  // filter changes shouldn't leave stale ids in the bulk-action bar.
  const dismissableVisibleIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of visible) if (canDismiss(r)) ids.add(r.id)
    return ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, admin, me.id])

  const selectedActive = useMemo(
    () => [...selected].filter((id) => dismissableVisibleIds.has(id)),
    [selected, dismissableVisibleIds],
  )

  const allVisibleSelected =
    dismissableVisibleIds.size > 0 &&
    [...dismissableVisibleIds].every((id) => selected.has(id))
  const someVisibleSelected =
    !allVisibleSelected &&
    [...dismissableVisibleIds].some((id) => selected.has(id))

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
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of dismissableVisibleIds) next.delete(id)
      } else {
        for (const id of dismissableVisibleIds) next.add(id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function handleMarkDone() {
    if (selectedActive.length === 0) return
    setBusy(true)
    const results = await Promise.allSettled(
      selectedActive.map((id) => dismissReminder(id, me.id)),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    setBusy(false)
    setSelected(new Set())
    if (failed === 0) {
      toast.show(
        `Marked ${selectedActive.length} reminder${selectedActive.length === 1 ? '' : 's'} done`,
      )
    } else {
      toast.show(
        `Marked ${selectedActive.length - failed} done · ${failed} failed (check permissions)`,
      )
    }
  }

  function urgencyClass(r: Reminder): string {
    const ms = r.dueAt?.toMillis?.() ?? 0
    if (!ms) return 'text-ink-3'
    return isAfter(new Date(), new Date(ms)) ? 'text-bad' : 'text-warn'
  }

  function timeLabel(r: Reminder): string {
    const ms = r.dueAt?.toMillis?.() ?? 0
    if (!ms) return '—'
    const d = new Date(ms)
    const now = new Date()
    const diffMs = d.getTime() - now.getTime()
    const absH = Math.abs(diffMs) / (1000 * 60 * 60)
    if (diffMs < 0) {
      if (absH < 24) return `Overdue ${Math.round(absH)}h`
      return `Overdue ${format(d, 'MMM d')}`
    }
    if (absH < 24) return `In ${Math.round(absH)}h`
    if (absH < 24 * 7) return `In ${Math.round(absH / 24)} days`
    return format(d, 'MMM d')
  }

  return (
    <>
      <TasksDueBanner />

      <div className="flex flex-wrap gap-2">
        <FilterTab
          label={`All (${counts.all})`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterTab
          label={`Follow Up (${counts.followup})`}
          active={filter === 'followup'}
          onClick={() => setFilter('followup')}
        />
        <FilterTab
          label={`Missed Call (${counts.missed})`}
          active={filter === 'missed'}
          onClick={() => setFilter('missed')}
        />
        <FilterTab
          label={`Manual (${counts.manual})`}
          active={filter === 'manual'}
          onClick={() => setFilter('manual')}
        />
        <FilterTab
          label={`Assigned (${counts.assignment})`}
          active={filter === 'assignment'}
          onClick={() => setFilter('assignment')}
        />
      </div>

      {seeAll && (
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
          >
            <option value="all">All Salespeople</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {dismissableVisibleIds.size > 0 && (
        <div
          className={clsx(
            'flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] px-4 py-2 transition-colors',
            selectedActive.length > 0
              ? 'border-major bg-major-light/40'
              : 'border-line bg-white',
          )}
        >
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleSelected
              }}
              onChange={toggleAllVisible}
              aria-label="Select all visible reminders"
              className="h-4 w-4 cursor-pointer accent-major"
            />
            {selectedActive.length > 0 ? (
              <span className="text-major">
                {selectedActive.length} selected
              </span>
            ) : (
              <span>Select all</span>
            )}
          </label>

          {selectedActive.length > 0 && (
            <>
              <button
                onClick={clearSelection}
                className="text-[12px] font-medium text-ink-2 underline-offset-2 hover:underline"
              >
                clear
              </button>
              <div className="ml-auto">
                <button
                  onClick={handleMarkDone}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-major px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#4a3fb8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check size={13} />
                  {busy ? 'Marking…' : 'Mark as done'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-ink-3">
          <div className="text-3xl">🎉</div>
          <div className="font-display text-[15px] font-bold text-ink-1">
            All caught up
          </div>
          <p className="text-[12.5px]">
            {filter === 'all'
              ? 'No active reminders.'
              : `No ${filter} reminders.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((r) => {
            const rep = users.find((u) => u.id === r.repId)
            const deal = deals.find((d) => d.id === r.dealId)
            const dismissable = canDismiss(r)
            const isSelected = selected.has(r.id)
            return (
              <div
                key={r.id}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-[10px] border bg-white px-4 py-3 transition-all hover:border-major-mid hover:shadow-[0_2px_8px_rgba(91,79,207,.08)]',
                  isSelected ? 'border-major' : 'border-line',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(r.id)}
                  disabled={!dismissable}
                  aria-label={
                    dismissable
                      ? `Select ${r.merchantName || 'reminder'}`
                      : 'Not allowed to dismiss this reminder'
                  }
                  title={
                    dismissable
                      ? undefined
                      : "Only this rep's owner or an admin can mark it done"
                  }
                  className="h-4 w-4 flex-shrink-0 cursor-pointer accent-major disabled:cursor-not-allowed disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <div
                    className={clsx(
                      'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] text-[16px]',
                      r.type === 'missed' && 'bg-warn-light',
                      r.type === 'followup' && 'bg-info-light',
                      r.type === 'assignment' && 'bg-ok-light',
                      r.type === 'manual' && 'bg-major-light',
                    )}
                  >
                    {r.type === 'missed'
                      ? '📵'
                      : r.type === 'followup'
                        ? '📅'
                        : r.type === 'assignment'
                          ? '👋'
                          : '🔔'}
                  </div>
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold text-ink-1">
                      {r.merchantName || '—'}
                      <ProjectBadge
                        projectId={r.projectId}
                        projects={projects}
                        className="ml-2"
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
                      <span>{rep?.name ?? '—'}</span>
                      <span>·</span>
                      <span className="truncate">{r.note}</span>
                      {deal && (
                        <>
                          <span>·</span>
                          <StatusBadge
                            status={deal.status}
                            stages={stages}
                            className="!text-[10px]"
                          />
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    className={clsx(
                      'text-[12px] font-semibold whitespace-nowrap',
                      urgencyClass(r),
                    )}
                  >
                    {timeLabel(r)}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      )}

      <ReminderDetailModal
        reminderId={openId}
        onClose={() => setOpenId(null)}
        reminders={allReminders}
        deals={deals}
        stages={stages}
        projects={projects}
        users={users}
      />
    </>
  )
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors',
        active
          ? 'border-major bg-major text-white'
          : 'border-line bg-white text-ink-2 hover:border-major hover:text-major',
      )}
    >
      {label}
    </button>
  )
}

// ─── Tasks Due banner ───────────────────────────────────────────────────────
//
// A compact nudge counting the viewer's own active tasks that are overdue or
// due within 24h, with a button through to the Tasks page. Nothing is written
// to /reminders — this derives "due soon" from task deadlines at render time.
// Hidden entirely when nothing is due.

const TASK_ACTIVE: TaskStatus[] = ['Pending', 'In Progress', 'Not Reachable']
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function TasksDueBanner() {
  const me = useProfile()
  const { data: tasks } = useScopedTasks()

  const dueCount = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    return tasks.filter((t) => {
      if (t.assigneeId !== me.id) return false
      if (!TASK_ACTIVE.includes(t.status)) return false
      const ms = t.dueAt?.toMillis?.()
      if (ms == null) return false
      // Either past-due, or due within the next 24h.
      return ms - now <= ONE_DAY_MS
    }).length
  }, [tasks, me.id])

  if (dueCount === 0) return null

  return (
    <section className="flex items-center gap-3 rounded-xl border-[1.5px] border-warn/40 bg-warn-light/30 px-4 py-3">
      <AlertTriangle size={16} className="flex-shrink-0 text-warn" />
      <p className="flex-1 text-[13px] font-semibold text-ink-1">
        Tasks due soon.{' '}
        <span className="font-medium text-ink-2">
          {dueCount} {dueCount === 1 ? 'task needs' : 'tasks need'} attention
        </span>
      </p>
      <Link
        to="/tasks"
        className="flex-shrink-0 rounded-lg bg-major px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#4a3fb8]"
      >
        View tasks
      </Link>
    </section>
  )
}
