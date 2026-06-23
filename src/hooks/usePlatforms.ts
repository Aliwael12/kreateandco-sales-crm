import { useMemo } from 'react'
import { useCollection } from '@/hooks/useCollection'
import { COL, type Platform } from '@/lib/types'

/**
 * Live platform list. Admins manage it on the Admin page (the `platforms`
 * collection). A flat, name-sorted list (no hierarchy or ordering, unlike
 * industries + subcategories).
 *
 * - `platforms` — the raw docs (with ids), for the Admin manager.
 * - `names`     — sorted platform names, for the merchant dropdown.
 */
export function usePlatforms() {
  const { data, loading } = useCollection<Platform>(COL.platforms)
  const platforms = useMemo(
    () => data.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  )
  const names = useMemo(() => platforms.map((p) => p.name), [platforms])
  return { platforms, names, loading }
}
