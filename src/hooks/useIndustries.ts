import { useMemo } from 'react'
import { useCollection } from '@/hooks/useCollection'
import { COL, DEFAULT_INDUSTRIES, type Industry } from '@/lib/types'

/**
 * Live industry list. Admins manage it in Settings (the `industries`
 * collection). Until any exist — or if an admin deletes them all — callers
 * fall back to DEFAULT_INDUSTRIES so the merchant dropdowns are never empty.
 *
 * - `industries` — the raw docs (with ids), for the Settings manager.
 * - `names`      — sorted industry names, for the dropdowns.
 */
export function useIndustries() {
  const { data, loading } = useCollection<Industry>(COL.industries)
  const industries = useMemo(
    () =>
      data
        .slice()
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [data],
  )
  const names = useMemo(
    () =>
      industries.length > 0
        ? industries.map((i) => i.name)
        : DEFAULT_INDUSTRIES,
    [industries],
  )
  return { industries, names, loading }
}
