import { useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import clsx from 'clsx'
import { useCollection } from '@/hooks/useCollection'
import {
  COL,
  orderBy,
  limit as fbLimit,
  type Activity,
  type Deal,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'
import { ProjectBadge } from '@/components/ui/StatusBadge'
import Button from '@/components/ui/Button'
import DealDetailModal from '@/components/pipeline/DealDetailModal'
import { downloadCsv } from '@/lib/export'

const ICON_FOR: Record<string, string> = {
  'deal.create': '➕',
  'deal.update': '✏️',
  'deal.status': '✏️',
  'deal.comment': '💬',
  'deal.delete': '🗑️',
  'deal.reassign': '🔄',
  'merchant.create': '🏬',
  'merchant.update': '✏️',
  'reminder.create': '🔔',
  'reminder.dismiss': '✓',
  'reminder.reschedule': '📅',
  'user.create': '👤',
  'user.update': '👤',
  'project.create': '📁',
  'project.update': '📁',
  'stage.create': '🚦',
  'stage.update': '🚦',
}

export default function ActivitiesPage() {
  const { data: activities, loading } = useCollection<Activity>(
    COL.activities,
    [orderBy('createdAt', 'desc'), fbLimit(200)],
    'activities:recent200',
  )
  const { data: users } = useCollection<User>(COL.users)
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: deals } = useCollection<Deal>(COL.deals)
  const { data: stages } = useCollection<Stage>(COL.stages)

  const [userFilter, setUserFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  // Which deal's detail modal is open (from clicking a deal-related activity).
  const [openDealId, setOpenDealId] = useState<string | null>(null)
  const openDeal = openDealId
    ? (deals.find((d) => d.id === openDealId) ?? null)
    : null

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (userFilter !== 'all' && a.who !== userFilter) return false
      if (projectFilter !== 'all') {
        const projId = (a.meta?.projectId as string | undefined) ?? null
        if (projId !== projectFilter) return false
      }
      return true
    })
  }, [activities, userFilter, projectFilter])

  function handleExport() {
    const rows = [
      ['When', 'Who', 'Kind', 'Description'],
      ...filtered.map((a) => [
        a.createdAt?.toDate?.()
          ? format(a.createdAt.toDate(), 'yyyy-MM-dd HH:mm')
          : '',
        a.whoName || a.who,
        a.kind,
        a.text,
      ]),
    ]
    downloadCsv('activities-log', rows)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="all">All Team Members</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
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
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-ink-3">Export:</span>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            CSV
          </Button>
        </div>
      </div>

      <section className="rounded-xl border border-line bg-white px-5 py-3">
        {loading ? (
          <div className="py-10 text-center text-[13px] italic text-ink-3">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] italic text-ink-3">
            {activities.length === 0
              ? 'Nothing happening yet — activity will start appearing here as the team uses the app.'
              : 'No activity matches the current filters.'}
          </div>
        ) : (
          <div>
            {filtered.map((a) => {
              const projId = a.meta?.projectId as string | undefined
              // A deal-referencing activity (e.g. a comment) is clickable: it
              // opens that deal's detail so you see the comment + latest status,
              // rate, rep, etc. Only if the deal still exists.
              const dealId =
                a.refKind === 'deal' && a.refId && deals.some((d) => d.id === a.refId)
                  ? a.refId
                  : null
              return (
                <div
                  key={a.id}
                  onClick={dealId ? () => setOpenDealId(dealId) : undefined}
                  role={dealId ? 'button' : undefined}
                  tabIndex={dealId ? 0 : undefined}
                  onKeyDown={
                    dealId
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setOpenDealId(dealId)
                          }
                        }
                      : undefined
                  }
                  className={clsx(
                    '-mx-2 flex gap-3 rounded-lg border-b border-line px-2 py-3.5 last:border-0',
                    dealId &&
                      'cursor-pointer transition-colors hover:bg-ghost',
                  )}
                >
                  <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-ghost text-[15px]">
                    {ICON_FOR[a.kind] ?? '•'}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">
                        {a.whoName || a.who.slice(0, 6)}
                      </span>
                      <span className="text-[12.5px] text-ink-2">{a.text}</span>
                      {projId && (
                        <ProjectBadge
                          projectId={projId}
                          projects={projects}
                          className="!text-[10px]"
                        />
                      )}
                      {dealId && (
                        <span className="text-[10.5px] font-semibold text-major">
                          View →
                        </span>
                      )}
                      <span className="ml-auto text-[11.5px] text-ink-3">
                        {a.createdAt?.toDate?.()
                          ? formatDistanceToNow(a.createdAt.toDate(), {
                              addSuffix: true,
                            })
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <DealDetailModal
        deal={openDeal}
        onClose={() => setOpenDealId(null)}
        projects={projects}
        stages={stages}
        users={users}
      />
    </>
  )
}
