import { canSeeAll, useProfile } from '@/context/auth'
import { useCollection } from '@/hooks/useCollection'
import { COL, where, type Deal, type Reminder, type Task } from '@/lib/types'

/**
 * Scoped Firestore readers. Admins/Heads/BD get unfiltered listeners
 * (matching what the security rules let through). Reps & Interns get a
 * server-side `where(...)` filter so Firestore never even ships them docs
 * they couldn't read — fewer reads, fewer bytes over the wire, faster page
 * loads.
 *
 * The cacheKey embeds the scope so the cache in useCollection keeps the
 * unscoped admin listener separate from each rep's scoped listener.
 */

export function useScopedDeals() {
  const me = useProfile()
  const all = canSeeAll(me.role)
  return useCollection<Deal>(
    COL.deals,
    all ? [] : [where('repId', '==', me.id)],
    all ? undefined : `deals:repId=${me.id}`,
  )
}

export function useScopedReminders() {
  const me = useProfile()
  const all = canSeeAll(me.role)
  return useCollection<Reminder>(
    COL.reminders,
    all ? [] : [where('repId', '==', me.id)],
    all ? undefined : `reminders:repId=${me.id}`,
  )
}

export function useScopedTasks() {
  const me = useProfile()
  const all = canSeeAll(me.role)
  return useCollection<Task>(
    COL.tasks,
    all ? [] : [where('assigneeId', '==', me.id)],
    all ? undefined : `tasks:assigneeId=${me.id}`,
  )
}
