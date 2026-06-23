import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Search, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { useCollection } from '@/hooks/useCollection'
import { useMerchantSearch } from '@/hooks/useMerchantSearch'
import { useScopedTasks } from '@/hooks/useScopedCollections'
import {
  COL,
  TASK_STATUSES,
  type Merchant,
  type Project,
  type Task,
  type TaskStatus,
  type User,
} from '@/lib/types'
import { useProfile, isAdmin, isHead, canSeeAll, canManageTasks } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { createTask, deleteTask, updateTaskStatus } from '@/lib/data'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { ProjectBadge } from '@/components/ui/StatusBadge'

// "Active" = not completed; only active tasks count as overdue.
const ACTIVE_STATUSES: TaskStatus[] = [
  'Pending',
  'In Progress',
  'Not Reachable',
]

function dueMs(t: Task): number | null {
  return t.dueAt?.toMillis?.() ?? null
}

function isOverdue(t: Task, now = Date.now()): boolean {
  const ms = dueMs(t)
  if (ms == null) return false
  if (!ACTIVE_STATUSES.includes(t.status)) return false
  return ms < now
}

function dueLabel(t: Task, now = Date.now()): {
  text: string
  tone: 'overdue' | 'soon' | 'future' | 'none'
} {
  const ms = dueMs(t)
  if (ms == null) return { text: '—', tone: 'none' }
  const diff = ms - now
  const days = diff / (1000 * 60 * 60 * 24)
  if (!ACTIVE_STATUSES.includes(t.status)) {
    return { text: format(ms, 'MMM d'), tone: 'none' }
  }
  if (diff < 0) {
    const abs = Math.abs(days)
    return {
      text: abs < 1 ? 'Overdue today' : `Overdue ${Math.round(abs)}d`,
      tone: 'overdue',
    }
  }
  if (days <= 1) return { text: 'Due within 24h', tone: 'soon' }
  return { text: format(ms, 'MMM d'), tone: 'future' }
}

export default function TasksPage() {
  const me = useProfile()
  const toast = useToast()
  const admin = isAdmin(me.role)
  // Admins and Sales Heads can create / delete tasks and assign them to
  // reps; BD and reps cannot. Status updates stay limited to admins and the
  // task's own assignee (see TaskRow), matching the Firestore rules.
  const canManage = canManageTasks(me.role)
  const seeAll = canSeeAll(me.role)

  const { data: tasks } = useScopedTasks()
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: users } = useCollection<User>(COL.users)

  const [createOpen, setCreateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [projectFilter, setProjectFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')

  // Visibility: admins/heads/BD see everything (with optional filters);
  // reps/interns see only tasks assigned to them. Rules enforce the same.
  const visible = useMemo(() => {
    // Overdue logic depends on wall-clock time. Re-running it on every
    // render is fine — the lint rule's "purity" concern doesn't apply.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    return tasks
      .filter((t) => (seeAll ? true : t.assigneeId === me.id))
      .filter((t) =>
        statusFilter === 'all' ? true : t.status === statusFilter,
      )
      .filter((t) => (overdueOnly ? isOverdue(t, now) : true))
      .filter((t) =>
        seeAll && projectFilter !== 'all' ? t.projectId === projectFilter : true,
      )
      .filter((t) =>
        seeAll && assigneeFilter !== 'all'
          ? t.assigneeId === assigneeFilter
          : true,
      )
      .sort((a, b) => {
        // Overdue first (most overdue at top), then due-soon, then by status
        // (pending first), then by createdAt desc.
        const aOver = isOverdue(a, now)
        const bOver = isOverdue(b, now)
        if (aOver !== bOver) return aOver ? -1 : 1
        if (aOver && bOver) {
          return (dueMs(a) ?? 0) - (dueMs(b) ?? 0)
        }
        if (a.status === 'Pending' && b.status !== 'Pending') return -1
        if (a.status !== 'Pending' && b.status === 'Pending') return 1
        const aMs = a.createdAt?.toMillis?.() ?? 0
        const bMs = b.createdAt?.toMillis?.() ?? 0
        return bMs - aMs
      })
  }, [
    tasks,
    seeAll,
    me.id,
    statusFilter,
    overdueOnly,
    projectFilter,
    assigneeFilter,
  ])

  // Admin-only: count of overdue active tasks across everyone they can see.
  // Drives the red banner at the top so they spot missed deadlines fast.
  const overdueCount = useMemo(() => {
    if (!seeAll) return 0
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    return tasks.filter((t) => isOverdue(t, now)).length
  }, [tasks, seeAll])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="font-display text-[18px] font-bold text-ink-1">
          {seeAll ? 'Tasks' : 'My Tasks'}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={12} /> New Task
            </Button>
          )}
        </div>
      </div>

      {seeAll && overdueCount > 0 && (
        <button
          type="button"
          onClick={() => setOverdueOnly((v) => !v)}
          className={clsx(
            'flex items-center gap-2 rounded-xl border-[1.5px] px-4 py-2.5 text-left transition-colors',
            overdueOnly
              ? 'border-bad bg-bad-light/80'
              : 'border-bad/40 bg-bad-light/40 hover:border-bad',
          )}
        >
          <AlertTriangle size={16} className="text-bad" />
          <span className="flex-1 text-[13px] font-semibold text-bad">
            {overdueCount} task{overdueCount === 1 ? '' : 's'} overdue
            {!overdueOnly && (
              <span className="ml-1 font-medium text-bad/80">
                — click to filter
              </span>
            )}
          </span>
          {overdueOnly && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-bad">
              showing overdue only
            </span>
          )}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskStatus)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
        >
          <option value="all">All Statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {seeAll && (
          <>
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
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[13px] outline-none focus:border-major"
            >
              <option value="all">All Salespeople</option>
              {users
                .filter((u) => u.role !== 'Admin')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </>
        )}

        <div className="ml-auto text-[12px] text-ink-3">
          {visible.length} {visible.length === 1 ? 'task' : 'tasks'}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-ink-3">
          <div className="text-3xl">📞</div>
          <div className="font-display text-[15px] font-bold text-ink-1">
            No tasks
          </div>
          <p className="text-[12.5px]">
            {canManage
              ? 'Click + New Task to assign a call to a salesperson.'
              : 'You have no tasks assigned right now.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  'Task',
                  'Lead',
                  'Project',
                  'Assigned To',
                  'Due',
                  'Status',
                  'Status Note',
                  'Assigned',
                ].map((h) => (
                  <th
                    key={h}
                    className="border-b-2 border-line bg-ghost px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
                {canManage && (
                  <th
                    className="w-12 border-b-2 border-line bg-ghost px-3 py-2.5"
                    aria-label="Actions"
                  />
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  me={me}
                  admin={admin}
                  canManage={canManage}
                  users={users}
                  projects={projects}
                  onStatusError={(msg) => toast.show(msg)}
                  onDeleted={() => toast.show('Task deleted')}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <CreateTaskModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          projects={projects}
          users={users}
        />
      )}
    </>
  )
}

interface TaskRowProps {
  task: Task
  me: User
  admin: boolean
  canManage: boolean
  users: User[]
  projects: Project[]
  onStatusError: (msg: string) => void
  onDeleted: () => void
}

function TaskRow({
  task,
  me,
  admin,
  canManage,
  users,
  projects,
  onStatusError,
  onDeleted,
}: TaskRowProps) {
  const assignee = users.find((u) => u.id === task.assigneeId)
  const canUpdateStatus = admin || task.assigneeId === me.id
  const [draftNote, setDraftNote] = useState(task.statusNote ?? '')
  // Track the last-saved note so the inline save button only enables on change.
  const [savedNote, setSavedNote] = useState(task.statusNote ?? '')
  const [busy, setBusy] = useState(false)

  // Re-sync local draft when the underlying task note changes (e.g. another
  // tab updated it). Done with a stable key check rather than useEffect to
  // avoid a stale-write race during typing.
  if (savedNote !== (task.statusNote ?? '') && !busy && draftNote === savedNote) {
    setSavedNote(task.statusNote ?? '')
    setDraftNote(task.statusNote ?? '')
  }

  async function setStatus(next: TaskStatus) {
    if (!canUpdateStatus) return
    setBusy(true)
    try {
      await updateTaskStatus(task.id, { status: next, by: me.id })
    } catch (err) {
      onStatusError(
        err instanceof Error ? err.message : "Couldn't update status",
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (!canUpdateStatus) return
    if (draftNote === savedNote) return
    setBusy(true)
    try {
      await updateTaskStatus(task.id, {
        status: task.status,
        statusNote: draftNote,
        by: me.id,
      })
      setSavedNote(draftNote)
    } catch (err) {
      onStatusError(err instanceof Error ? err.message : "Couldn't save note")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!canManage) return
    const label = task.title || task.merchantName || 'this task'
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`))
      return
    setBusy(true)
    try {
      await deleteTask(task.id)
      onDeleted()
    } catch (err) {
      onStatusError(err instanceof Error ? err.message : "Couldn't delete")
    } finally {
      setBusy(false)
    }
  }

  const createdLabel = task.createdAt?.toMillis
    ? format(task.createdAt.toMillis(), 'MMM d, HH:mm')
    : '—'
  const due = dueLabel(task)
  const overdue = isOverdue(task)

  return (
    <tr
      className={clsx(
        'border-b border-line last:border-0 hover:bg-[#f8f8fd]',
        overdue && 'bg-bad-light/30',
      )}
    >
      <td className="max-w-[260px] px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-ink-1">
            {task.title || (
              <span className="italic text-ink-3">(untitled)</span>
            )}
          </span>
          {task.note && (
            <span className="text-[11.5px] text-ink-3">{task.note}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[12.5px] text-ink-2">
        {task.merchantName || <span className="italic text-ink-4">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <ProjectBadge projectId={task.projectId} projects={projects} />
      </td>
      <td className="px-3 py-2.5 text-[12.5px] text-ink-2">
        {assignee ? (
          <span className="flex items-center gap-1.5">
            <span
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: assignee.color }}
            >
              {assignee.name[0]?.toUpperCase()}
            </span>
            <span>{assignee.name}</span>
            <span className="text-[10.5px] uppercase tracking-wider text-ink-3">
              {assignee.role}
            </span>
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-md px-2 py-px text-[11px] font-semibold',
            due.tone === 'overdue' && 'bg-bad-light text-bad',
            due.tone === 'soon' && 'bg-warn-light text-warn',
            due.tone === 'future' && 'bg-ghost text-ink-2',
            due.tone === 'none' && 'italic text-ink-4',
          )}
        >
          {due.tone === 'overdue' && <AlertTriangle size={11} />}
          {due.text}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <select
          value={task.status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
          disabled={!canUpdateStatus || busy}
          className={clsx(
            'cursor-pointer rounded-md border-[1.5px] px-2 py-1 text-[12px] font-semibold outline-none focus:border-major',
            STATUS_STYLE[task.status],
            !canUpdateStatus && 'cursor-not-allowed opacity-70',
          )}
          title={
            canUpdateStatus
              ? 'Update status'
              : 'Only the assignee or an admin can update this task'
          }
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2.5">
        {canUpdateStatus ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Add a note…"
              className="w-[180px] rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[12px] outline-none focus:border-major"
            />
            {draftNote !== savedNote && (
              <button
                type="button"
                onClick={saveNote}
                disabled={busy}
                className="rounded-md bg-major px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#4a3fb8] disabled:opacity-50"
              >
                Save
              </button>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-ink-2">
            {task.statusNote || <span className="italic text-ink-4">—</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-[11.5px] text-ink-3 whitespace-nowrap">
        <div>{createdLabel}</div>
        <div className="text-ink-4">by {task.createdByName}</div>
      </td>
      {canManage && (
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label="Delete task"
            title="Delete task"
            className="cursor-pointer rounded-md border border-transparent p-1.5 text-ink-3 transition-colors hover:border-line hover:bg-white hover:text-[#d63c2e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </td>
      )}
    </tr>
  )
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  Pending: 'border-warn/40 bg-warn-light text-warn',
  'In Progress': 'border-info/40 bg-info-light text-info',
  Completed: 'border-ok/40 bg-ok-light text-ok',
  'Not Reachable': 'border-line bg-ghost text-ink-2',
  'Not Interested': 'border-bad/40 bg-bad-light text-bad',
}

interface CreateTaskModalProps {
  open: boolean
  onClose: () => void
  projects: Project[]
  users: User[]
}

function CreateTaskModal({
  open,
  onClose,
  projects,
  users,
}: CreateTaskModalProps) {
  const me = useProfile()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [merchantQuery, setMerchantQuery] = useState('')
  // The picked merchant, tracked locally as {id, name} — we no longer hold the
  // whole merchants collection in memory to resolve it.
  const [selectedMerchant, setSelectedMerchant] = useState<{
    id: string
    name: string
  } | null>(null)
  const [projectId, setProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [note, setNote] = useState('')
  // `<input type="date">` yields YYYY-MM-DD; we treat empty as no deadline.
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle('')
    setMerchantQuery('')
    setSelectedMerchant(null)
    setProjectId('')
    setAssigneeId('')
    setNote('')
    setDueDate('')
    setError(null)
  }

  // On-demand merchant search (debounced Firestore prefix query) instead of
  // filtering a full in-memory copy of the collection. Suppress results once a
  // merchant is selected.
  const { hits: merchantHits } = useMerchantSearch(
    selectedMerchant ? '' : merchantQuery,
  )
  const merchantMatches = selectedMerchant ? [] : merchantHits

  // Who the creator may assign to:
  //   • Admin → Heads and reps (anyone who isn't an Admin)
  //   • Head  → reps only (not other Heads, not Admins)
  // This mirrors the tasks_insert RLS, which only lets a non-admin assign to a
  // non-head assignee.
  const iAmAdmin = isAdmin(me.role)
  const assigneeOptions = useMemo(() => {
    const eligible = users.filter(
      (u) =>
        u.role !== 'Admin' &&
        !u.disabled &&
        // A Head can only hand work down to reps, never to another Head.
        (iAmAdmin || !isHead(u.role)),
    )
    if (!projectId) return eligible
    const onProject = eligible.filter((u) => u.projectIds.includes(projectId))
    // Fall back to all eligible if nobody is on the project so the creator
    // isn't stuck — they can still assign cross-project.
    if (onProject.length === 0) return eligible
    // Heads oversee every project, so keep them assignable even when they
    // aren't a member of the selected one (Admin creator only — a Head creator
    // has already had Heads filtered out above). Append any Heads not already
    // on the project.
    const onProjectIds = new Set(onProject.map((u) => u.id))
    const heads = eligible.filter(
      (u) => isHead(u.role) && !onProjectIds.has(u.id),
    )
    return [...onProject, ...heads]
  }, [users, projectId, iAmAdmin])

  function pickMerchant(m: Merchant) {
    setSelectedMerchant({ id: m.id, name: m.name })
    setMerchantQuery(m.name)
  }

  function clearMerchant() {
    setSelectedMerchant(null)
    setMerchantQuery('')
  }

  async function save() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Give the task a short title.')
      return
    }
    if (!projectId) {
      setError('Choose a project.')
      return
    }
    if (!assigneeId) {
      setError('Choose a salesperson.')
      return
    }
    // Merchant is optional now — pick up the linked one only if the admin
    // selected from the typeahead. A query string typed but not chosen is
    // ignored on purpose so we don't write a half-set reference.
    const m = selectedMerchant
    // <input type="date"> returns local-time YYYY-MM-DD. Treat the deadline
    // as end-of-day so "due today" stays valid for the whole day.
    let dueAt: Date | null = null
    if (dueDate) {
      const [y, mo, d] = dueDate.split('-').map((n) => parseInt(n, 10))
      if (y && mo && d) dueAt = new Date(y, mo - 1, d, 23, 59, 59, 999)
    }
    setBusy(true)
    setError(null)
    try {
      await createTask({
        title: trimmedTitle,
        merchantId: m?.id,
        merchantName: m?.name,
        projectId,
        assigneeId,
        note: note.trim(),
        createdBy: me.id,
        createdByName: me.name,
        dueAt,
      })
      toast.show(
        `Task assigned to ${users.find((u) => u.id === assigneeId)?.name ?? 'rep'}`,
      )
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create task")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="New Task"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Creating…' : 'Create Task'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Task *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Call back about pricing, send proposal…"
          autoFocus
          className="w-full rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Lead (optional)
        </label>
        {selectedMerchant ? (
          <div className="flex items-center gap-2 rounded-lg border-[1.5px] border-major bg-major-light/40 px-3 py-2">
            <span className="flex-1 text-[13.5px] font-semibold text-ink-1">
              {selectedMerchant.name}
            </span>
            <button
              type="button"
              onClick={clearMerchant}
              aria-label="Clear lead"
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white hover:text-ink-1"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-[10px] text-ink-3"
            />
            <input
              type="search"
              value={merchantQuery}
              onChange={(e) => setMerchantQuery(e.target.value)}
              placeholder="Search lead by name…"
              className="w-full rounded-lg border-[1.5px] border-line bg-white px-3 py-2 pl-8 text-[13.5px] outline-none transition-colors focus:border-major"
            />
            {merchantMatches.length > 0 && (
              <div className="absolute z-10 mt-1 flex w-full flex-col rounded-lg border border-line bg-white shadow-lg">
                {merchantMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickMerchant(m)}
                    className="flex items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-ghost"
                  >
                    <span className="flex-1 font-medium">{m.name}</span>
                    {m.industry && (
                      <span className="text-[11px] text-ink-3">
                        {m.industry}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {merchantQuery.trim() && merchantMatches.length === 0 && (
              <div className="mt-1 text-[12px] italic text-ink-3">
                No matches. Add the lead from All Leads first, or
                leave this blank.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
            Project *
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
          >
            <option value="">— select —</option>
            {/* New tasks only target in-progress projects. */}
            {projects
              .filter((p) => !p.completed)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
            Assign To *
          </label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
          >
            <option value="">— select —</option>
            {assigneeOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Due Date (optional)
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
        />
        <span className="text-[11px] italic text-ink-3">
          A reminder will surface for the assignee one day before, and an
          overdue badge appears once the date passes.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What should the salesperson say or ask about?"
          className="w-full resize-y rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-bad-light px-3 py-2 text-[12.5px] font-medium text-bad">
          {error}
        </div>
      )}
    </Modal>
  )
}
