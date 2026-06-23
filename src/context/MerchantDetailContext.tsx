import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { mapMerchant } from '@/lib/db'
import { useCollection } from '@/hooks/useCollection'
import {
  COL,
  type Merchant,
  type Project,
  type Stage,
  type User,
} from '@/lib/types'
import MerchantDetailModal from '@/components/merchants/MerchantDetailModal'
import { MerchantDetailContext } from '@/context/merchantDetail'

export function MerchantDetailProvider({ children }: { children: ReactNode }) {
  // Reference data the detail modal needs. These are small, rarely-changing
  // collections and (with the disk cache) cost reads only on first load.
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: stages } = useCollection<Stage>(COL.stages)
  const { data: users } = useCollection<User>(COL.users)

  // Only the single merchant being viewed is fetched — we no longer subscribe
  // to the entire `merchants` collection app-wide just to find one by id. That
  // app-wide listener was the single largest source of Firestore reads (it ran
  // for every session, on login, over the largest collection).
  const [id, setId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState<Merchant | null>(null)

  useEffect(() => {
    if (!id) {
      // Clearing the fetched merchant when the modal closes — synchronizing
      // local state with the external `id`, the sanctioned use of an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMerchant(null)
      return
    }
    let cancelled = false
    supabase
      .from(COL.merchants)
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setMerchant(data && !error ? mapMerchant(data) : null)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <MerchantDetailContext.Provider value={{ open: (mid) => setId(mid) }}>
      {children}
      <MerchantDetailModal
        merchantId={id}
        onClose={() => setId(null)}
        projects={projects}
        stages={stages}
        users={users}
        // The modal resolves the open merchant out of this array by id; pass
        // just the one we fetched.
        merchants={merchant ? [merchant] : []}
      />
    </MerchantDetailContext.Provider>
  )
}
