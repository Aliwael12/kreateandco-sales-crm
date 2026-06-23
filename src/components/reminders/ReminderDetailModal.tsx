import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge, { ProjectBadge } from '@/components/ui/StatusBadge'
import {
  dismissReminder,
  logActivity,
  rescheduleReminder,
  updateDealField,
} from '@/lib/data'
import { useProfile } from '@/context/auth'
import { useToast } from '@/components/ui/toast-context'
import type {
  Deal,
  Project,
  Reminder,
  Stage,
  User,
} from '@/lib/types'

interface Props {
  reminderId: string | null
  onClose: () => void
  reminders: Reminder[]
  deals: Deal[]
  stages: Stage[]
  projects: Project[]
  users: User[]
}

export default function ReminderDetailModal({
  reminderId,
  onClose,
  reminders,
  deals,
  stages,
  projects,
  users,
}: Props) {
  const me = useProfile()
  const toast = useToast()
  const reminder = reminderId
    ? (reminders.find((r) => r.id === reminderId) ?? null)
    : null
  const deal = reminder ? deals.find((d) => d.id === reminder.dealId) : null
  const rep = reminder ? users.find((u) => u.id === reminder.repId) : null

  const [newStatus, setNewStatus] = useState<string>('')
  const [rescheduleDate, setRescheduleDate] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (reminder && deal) {
      // Resetting the form when a different reminder/deal is opened — syncing
      // local state to external props.
      /* eslint-disable react-hooks/set-state-in-effect */
      setNewStatus(deal.status)
      const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      setRescheduleDate(format(inTwoDays, 'yyyy-MM-dd'))
      setNote('')
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminder?.id, deal?.id])

  if (!reminder) return null

  async function handleDismiss() {
    if (!reminder) return
    setBusy(true)
    try {
      if (deal && newStatus && newStatus !== deal.status) {
        await updateDealField(deal.id, 'status', newStatus, me.id)
      }
      if (note && deal) {
        const stamped = `${format(new Date(), 'yyyy-MM-dd')}: ${note}`
        const merged = deal.comments
          ? `${deal.comments} | ${stamped}`
          : stamped
        await updateDealField(deal.id, 'comments', merged, me.id)
      }
      await dismissReminder(reminder.id, me.id)
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'reminder.dismiss',
        text: `dismissed reminder for ${reminder.merchantName}`,
        refId: reminder.id,
        refKind: 'reminder',
      })
      toast.show('Done · reminder dismissed')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function handleReschedule() {
    if (!reminder || !rescheduleDate) return
    setBusy(true)
    try {
      const dt = new Date(rescheduleDate + 'T09:00:00')
      await rescheduleReminder(reminder.id, dt)
      if (note && deal) {
        const stamped = `${format(new Date(), 'yyyy-MM-dd')}: ${note}`
        const merged = deal.comments
          ? `${deal.comments} | ${stamped}`
          : stamped
        await updateDealField(deal.id, 'comments', merged, me.id)
      }
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'reminder.reschedule',
        text: `rescheduled reminder for ${reminder.merchantName} to ${rescheduleDate}`,
        refId: reminder.id,
        refKind: 'reminder',
      })
      toast.show('Reminder rescheduled')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!reminderId}
      onClose={onClose}
      title="Reminder"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            onClick={handleReschedule}
            disabled={busy}
            className="!border-warn !text-warn hover:!bg-warn-light"
          >
            Reschedule
          </Button>
          <Button onClick={handleDismiss} disabled={busy}>
            {busy ? 'Saving…' : 'Mark done & dismiss'}
          </Button>
        </>
      }
    >
      <div>
        <div className="mb-2 flex gap-2">
          <span className="rounded-md bg-warn-light px-2 py-px text-[11px] font-semibold uppercase tracking-wider text-warn">
            {reminder.type}
          </span>
          <ProjectBadge projectId={reminder.projectId} projects={projects} />
        </div>
        <div className="font-display text-[17px] font-extrabold text-ink-1">
          {reminder.merchantName}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-3">
          {rep?.name ?? '—'} · {reminder.note}
        </div>
      </div>

      {deal && (
        <div className="flex flex-wrap gap-4 rounded-[10px] bg-ghost px-4 py-3.5">
          <Info label="Current Status">
            <StatusBadge status={deal.status} stages={stages} />
          </Info>
          <Info label="Take Rate" value={deal.rate || '—'} />
          <Info
            label="Due"
            value={
              reminder.dueAt
                ? format(reminder.dueAt.toDate(), 'MMM d, yyyy HH:mm')
                : '—'
            }
          />
        </div>
      )}

      {deal && (
        <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
          <Field label="Change status">
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              className="w-full cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
            >
              {stages
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Reschedule to">
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="rounded-lg border-[1.5px] border-line px-3 py-2 text-[13.5px] outline-none focus:border-major"
            />
          </Field>
          <Field label="Add note (appended to deal comments)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened on this call/follow-up?"
              className="min-h-[70px] w-full resize-y rounded-lg border-[1.5px] border-line px-3 py-2 text-[13.5px] outline-none focus:border-major"
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function Info({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="min-w-[110px] flex-1">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-semibold text-ink-1">
        {children ?? value}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </label>
      {children}
    </div>
  )
}
