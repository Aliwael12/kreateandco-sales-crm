import { useCallback, useMemo } from 'react'
import { useCollection } from '@/hooks/useCollection'
import { COL, type Subcategory } from '@/lib/types'

/**
 * Live subcategory list. Admins manage them in Settings (nested under each
 * industry). Subcategories belong to an industry by NAME (matching how merchants
 * reference industries). A merchant may have an industry alone, or industry +
 * subcategory.
 *
 * - `subcategories`   — all raw docs (with ids), for the Settings manager.
 * - `byIndustry(name)`— the subcategories under a given industry, name-sorted.
 * - `namesFor(name)`  — just the subcategory names for an industry's dropdown.
 */
export function useSubcategories() {
  const { data, loading } = useCollection<Subcategory>(COL.subcategories)

  const subcategories = useMemo(
    () =>
      data
        .slice()
        .sort(
          (a, b) =>
            a.industry.localeCompare(b.industry) ||
            a.name.localeCompare(b.name),
        ),
    [data],
  )

  const byIndustry = useCallback(
    (industry: string): Subcategory[] =>
      subcategories.filter((s) => s.industry === industry),
    [subcategories],
  )

  const namesFor = useCallback(
    (industry: string): string[] => byIndustry(industry).map((s) => s.name),
    [byIndustry],
  )

  return { subcategories, byIndustry, namesFor, loading }
}
