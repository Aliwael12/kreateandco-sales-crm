import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useProfile } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import { supabase } from '@/lib/supabase'
import { refreshCollectionByPath } from '@/hooks/useCollection'
import { COL, type Project, type User } from '@/lib/types'
import { logActivity } from '@/lib/data'

interface Props {
  project: Project | null
  users: User[]
  onClose: () => void
}

export default function ProjectMembersModal({ project, users, onClose }: Props) {
  const me = useProfile()
  const toast = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const sortedUsers = useMemo(() => {
    const order = ['Admin', 'Head', 'Sales Head', 'BD', 'Rep', 'Intern']
    return users
      .filter((u) => !u.disabled)
      .slice()
      .sort((a, b) => {
        const oa = order.indexOf(a.role)
        const ob = order.indexOf(b.role)
        if (oa !== ob) return oa - ob
        return a.name.localeCompare(b.name)
      })
  }, [users])

  useEffect(() => {
    if (!project) return
    const next = new Set<string>()
    for (const u of users) {
      if (u.projectIds?.includes(project.id)) next.add(u.id)
    }
    // Syncing the selection to the opened project — the sanctioned use of an
    // effect (adjusting local state when an external prop changes).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, users])

  if (!project) return null

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function save() {
    if (!project) return
    setBusy(true)
    try {
      const added: string[] = []
      const removed: string[] = []
      const writes: Promise<void>[] = []

      for (const u of users) {
        const has = u.projectIds?.includes(project.id) ?? false
        const should = selected.has(u.id)
        if (has === should) continue

        const nextProjectIds = should
          ? [...(u.projectIds ?? []), project.id]
          : (u.projectIds ?? []).filter((pid) => pid !== project.id)

        writes.push(
          Promise.resolve(
            supabase
              .from(COL.users)
              .update({ project_ids: nextProjectIds })
              .eq('id', u.id),
          ).then(({ error }) => {
            if (error) throw new Error(error.message)
          }),
        )
        if (should) added.push(u.name)
        else removed.push(u.name)
      }

      if (writes.length === 0) {
        toast.show('No changes')
        onClose()
        return
      }

      await Promise.all(writes)
      void refreshCollectionByPath(COL.users)

      const parts: string[] = []
      if (added.length) parts.push(`added ${added.join(', ')}`)
      if (removed.length) parts.push(`removed ${removed.join(', ')}`)
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'project.update',
        text: `${project.name}: ${parts.join('; ')}`,
        refId: project.id,
        refKind: 'project',
      })
      toast.show(
        `${project.name}: ${added.length + removed.length} change${
          added.length + removed.length === 1 ? '' : 's'
        }`,
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Members — ${project.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] text-ink-3">
        Toggle each team member to add or remove them from this project. Reps
        you add here will see this project in their <b>My Projects</b> page.
      </p>
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-ghost p-2">
        {sortedUsers.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12.5px] italic text-ink-3">
            No active team members yet.
          </p>
        ) : (
          sortedUsers.map((u) => {
            const checked = selected.has(u.id)
            return (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(u.id)}
                  className="h-4 w-4 cursor-pointer accent-major"
                />
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: u.color }}
                >
                  {u.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-ink-1">
                    {u.name}
                  </div>
                  <div className="text-[11.5px] text-ink-3">
                    {u.role} · {u.email}
                  </div>
                </div>
              </label>
            )
          })
        )}
      </div>
    </Modal>
  )
}
