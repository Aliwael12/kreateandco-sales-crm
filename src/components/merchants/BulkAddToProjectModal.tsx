import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useProfile, isAdmin, canSeeAll } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { supabase } from '@/lib/supabase'
import { newId } from '@/lib/db'
import { refreshCollectionByPath } from '@/hooks/useCollection'
import { logActivity } from '@/lib/data'
import {
  COL,
  type Deal,
  type Merchant,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  selectedMerchants: Merchant[]
  deals: Deal[]
  projects: Project[]
  stages: Stage[]
  users: User[]
}

export default function BulkAddToProjectModal({
  open,
  onClose,
  selectedMerchants,
  deals,
  projects,
  stages,
  users,
}: Props) {
  const me = useProfile()
  const toast = useToast()

  const [projectId, setProjectId] = useState<string>('')
  const [assigneeId, setAssigneeId] = useState<string>(me.id)
  const [statusName, setStatusName] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // Stages sorted by order; default the status select to the first stage.
  const orderedStages = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )
  const defaultStatus = orderedStages[0]?.name ?? 'Initial Contact'
  const effectiveStatus = statusName || defaultStatus

  // Active users (excluding disabled ones) for the assignee picker.
  const assigneeOptions = useMemo(
    () =>
      users
        .filter((u) => !u.disabled)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )

  // Count how many of the selected merchants already have a deal in the
  // chosen project (those will be SKIPPED via dedup).
  const stats = useMemo(() => {
    if (!projectId) return { willCreate: 0, willSkip: 0 }
    const existing = new Set(
      deals
        .filter((d) => d.projectId === projectId && d.merchantId)
        .map((d) => d.merchantId),
    )
    let create = 0
    let skip = 0
    for (const m of selectedMerchants) {
      if (existing.has(m.id)) skip++
      else create++
    }
    return { willCreate: create, willSkip: skip }
  }, [projectId, deals, selectedMerchants])

  const targetProject = projects.find((p) => p.id === projectId)
  const assignee = users.find((u) => u.id === assigneeId)
  // Only in-progress projects are valid targets for new deals (the name lookup
  // above keeps the full list so an already-picked project still resolves).
  const activeProjects = projects.filter((p) => !p.completed)

  // Sales Head can assign to anyone; reps can only assign to themselves
  // (the resulting deals must be owned by the caller per security rules).
  const canPickAnyAssignee = isAdmin(me.role) || canSeeAll(me.role)

  async function runBulkAdd() {
    if (!projectId || !assigneeId) {
      setResult('Pick a project and an assignee.')
      return
    }
    if (selectedMerchants.length === 0) {
      setResult('No leads selected.')
      return
    }
    if (!canPickAnyAssignee && assigneeId !== me.id) {
      setResult('You can only add leads under your own name.')
      return
    }

    setBusy(true)
    setResult(null)
    try {
      const existing = new Set(
        deals
          .filter((d) => d.projectId === projectId && d.merchantId)
          .map((d) => d.merchantId),
      )

      const toAdd = selectedMerchants.filter((m) => !existing.has(m.id))

      // One bulk insert (chunked to keep request bodies reasonable). Each row
      // gets a generated text id, matching the rest of the app.
      let created = 0
      for (let i = 0; i < toAdd.length; i += 400) {
        const chunk = toAdd.slice(i, i + 400)
        const rows = chunk.map((m) => ({
          id: newId(),
          merchant_id: m.id,
          merchant_name: m.name,
          project_id: projectId,
          rep_id: assigneeId,
          status: effectiveStatus,
          rate: '',
          comments: '',
          created_by: me.id,
          updated_by: me.id,
        }))
        const { error } = await supabase.from(COL.deals).insert(rows)
        if (error) throw new Error(error.message)
        created += rows.length
      }
      void refreshCollectionByPath(COL.deals)

      // If the assignee isn't already attached to this project, attach them.
      if (assignee && !(assignee.projectIds ?? []).includes(projectId)) {
        const next = [...(assignee.projectIds ?? []), projectId]
        // non-fatal — admin can attach manually if RLS rejects.
        await supabase
          .from(COL.users)
          .update({ project_ids: next })
          .eq('id', assigneeId)
      }

      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'deal.create',
        text: `bulk-added ${created} lead(s) to ${targetProject?.name ?? 'a project'} under ${assignee?.name ?? 'rep'}`,
        refId: projectId,
        refKind: 'project',
        meta: {
          projectId,
          createdCount: created,
          selectedCount: selectedMerchants.length,
        },
      })

      toast.show(
        `Added ${created} lead${created === 1 ? '' : 's'} to ${targetProject?.name ?? 'project'}`,
      )
      setResult(
        `Done — ${created} deal${created === 1 ? '' : 's'} created. ${stats.willSkip} skipped (already in this project).`,
      )
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Bulk add failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${selectedMerchants.length} lead${
        selectedMerchants.length === 1 ? '' : 's'
      } to a project`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={runBulkAdd}
            disabled={busy || !projectId || stats.willCreate === 0}
          >
            {busy ? 'Adding…' : `Create ${stats.willCreate} deal${stats.willCreate === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Target project
        </label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
        >
          <option value="">— pick a project —</option>
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Assign to
        </label>
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          disabled={!canPickAnyAssignee}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major disabled:cursor-not-allowed disabled:opacity-60"
        >
          {assigneeOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.role}
            </option>
          ))}
        </select>
        {!canPickAnyAssignee && (
          <p className="text-[11.5px] text-ink-3">
            Reps can only assign to themselves. Ask an Admin or Sales Head to
            assign to another rep.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Initial status
        </label>
        <select
          value={effectiveStatus}
          onChange={(e) => setStatusName(e.target.value)}
          className="cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
        >
          {orderedStages.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {projectId && (
        <div className="rounded-lg bg-major-light/50 px-3.5 py-3 text-[12.5px] text-ink-2">
          <div>
            <b className="text-major">{stats.willCreate}</b> new deal{stats.willCreate === 1 ? '' : 's'} will be created in{' '}
            <b>{targetProject?.name}</b> under{' '}
            <b>{assignee?.name ?? '—'}</b>.
          </div>
          {stats.willSkip > 0 && (
            <div className="mt-0.5 text-ink-3">
              {stats.willSkip} lead{stats.willSkip === 1 ? '' : 's'} already
              have a deal in this project — those will be skipped.
            </div>
          )}
        </div>
      )}

      {result && (
        <div
          className={`rounded-lg px-3 py-2 text-[12.5px] ${
            result.startsWith('Done') ? 'bg-ok-light text-ok' : 'bg-bad-light text-bad'
          }`}
        >
          {result}
        </div>
      )}
    </Modal>
  )
}
