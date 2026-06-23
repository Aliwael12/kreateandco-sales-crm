import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { useCollection } from '@/hooks/useCollection'
import { useScopedTasks } from '@/hooks/useScopedCollections'
import {
  COL,
  TASK_STATUSES,
  type Project,
  type Task,
  type TaskStatus,
} from '@/lib/types'
import { useProfile } from '@/context/auth'
import SectionCard from '@/components/ui/SectionCard'
import { ProjectBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/toast-context'
import { updateTaskStatus } from '@/lib/data'

const ACTIVE_STATUSES: TaskStatus[] = [
  'Pending',
  'In Progress',
  'Not Reachable',
]

function dueInfo(t: Task, now = Date.now()) {
  const ms = t.dueAt?.toMillis?.()
  if (ms == null) return null
  const active = ACTIVE_STATUSES.includes(t.status)
  if (!active) return { text: format(ms, 'MMM d'), overdue: false, soon: false }
  const diff = ms - now
  const days = diff / (1000 * 60 * 60 * 24)
  if (diff < 0) {
    const abs = Math.abs(days)
    return {
      text: abs < 1 ? 'Overdue today' : `Overdue ${Math.round(abs)}d`,
      overdue: true,
      soon: false,
    }
  }
  if (days <= 1) return { text: 'Due within 24h', overdue: false, soon: true }
  return { text: format(ms, 'MMM d'), overdue: false, soon: false }
}

export default function MyTasksCard() {
  const me = useProfile()
  const toast = useToast()
  const { data: tasks } = useScopedTasks()
  const { data: projects } = useCollection<Project>(COL.projects)
  const [busyId, setBusyId] = useState<string | null>(null)

  const mine = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    return tasks
      .filter((t) => t.assigneeId === me.id)
      .sort((a, b) => {
        // Overdue first, then due-soon, then by status (pending → in progress
        // → others), then by createdAt desc.
        const ai = dueInfo(a, now)
        const bi = dueInfo(b, now)
        const aOver = !!ai?.overdue
        const bOver = !!bi?.overdue
        if (aOver !== bOver) return aOver ? -1 : 1
        const aSoon = !!ai?.soon
        const bSoon = !!bi?.soon
        if (aSoon !== bSoon) return aSoon ? -1 : 1
        const rank = (s: TaskStatus) =>
          s === 'Pending' ? 0 : s === 'In Progress' ? 1 : 2
        const ra = rank(a.status)
        const rb = rank(b.status)
        if (ra !== rb) return ra - rb
        const aMs = a.createdAt?.toMillis?.() ?? 0
        const bMs = b.createdAt?.toMillis?.() ?? 0
        return bMs - aMs
      })
      .slice(0, 5)
  }, [tasks, me.id])

  const pendingCount = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.assigneeId === me.id &&
          (t.status === 'Pending' || t.status === 'In Progress'),
      ).length,
    [tasks, me.id],
  )

  async function setStatus(taskId: string, next: TaskStatus) {
    setBusyId(taskId)
    try {
      await updateTaskStatus(taskId, { status: next, by: me.id })
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update status")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionCard
      title="My Tasks"
      subtitle={
        pendingCount > 0
          ? `${pendingCount} open · assigned calls`
          : 'assigned calls'
      }
    >
      {mine.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] italic text-ink-3">
          No tasks assigned to you. 🎉
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((t) => {
            const due = dueInfo(t)
            return (
              <li
                key={t.id}
                className={clsx(
                  'flex items-center gap-3 rounded-lg border bg-white px-3 py-2',
                  due?.overdue ? 'border-bad/60 bg-bad-light/30' : 'border-line',
                )}
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-1">
                    <span>
                      {t.title || t.merchantName || (
                        <span className="italic text-ink-3">(untitled)</span>
                      )}
                    </span>
                    <ProjectBadge
                      projectId={t.projectId}
                      projects={projects}
                    />
                    {due && (
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-md px-2 py-px text-[10.5px] font-semibold',
                          due.overdue && 'bg-bad-light text-bad',
                          due.soon && 'bg-warn-light text-warn',
                          !due.overdue && !due.soon && 'bg-ghost text-ink-2',
                        )}
                      >
                        {due.overdue && <AlertTriangle size={10} />}
                        {due.text}
                      </span>
                    )}
                  </div>
                  {t.merchantName && t.title && (
                    <div className="mt-0.5 text-[11.5px] text-ink-3">
                      Lead · {t.merchantName}
                    </div>
                  )}
                  {t.note && (
                    <div className="mt-0.5 text-[12px] text-ink-3">{t.note}</div>
                  )}
                </div>
                <select
                  value={t.status}
                  onChange={(e) => setStatus(t.id, e.target.value as TaskStatus)}
                  disabled={busyId === t.id}
                  className={clsx(
                    'cursor-pointer rounded-md border-[1.5px] px-2 py-1 text-[12px] font-semibold outline-none focus:border-major',
                    STATUS_STYLE[t.status],
                  )}
                  title="Update status"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </li>
            )
          })}
          {tasks.filter((t) => t.assigneeId === me.id).length > mine.length && (
            <li className="pt-1 text-center text-[12px]">
              <Link
                to="/tasks"
                className="font-semibold text-major hover:underline"
              >
                View all my tasks →
              </Link>
            </li>
          )}
        </ul>
      )}
    </SectionCard>
  )
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  Pending: 'border-warn/40 bg-warn-light text-warn',
  'In Progress': 'border-info/40 bg-info-light text-info',
  Completed: 'border-ok/40 bg-ok-light text-ok',
  'Not Reachable': 'border-line bg-ghost text-ink-2',
  'Not Interested': 'border-bad/40 bg-bad-light text-bad',
}
