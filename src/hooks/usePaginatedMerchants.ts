import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mapMerchant } from '@/lib/db'
import { type Merchant } from '@/lib/types'

// Smaller pages = fewer rows on the common case where a user opens the list,
// finds what they need on the first page, and never scrolls. `loadMore` fetches
// the next page on demand. 25 balances payload size against scroll frequency.
const PAGE_SIZE = 25

interface Options {
  search: string
  industry: string
  /** Optional subcategory under the selected industry. Empty string = no
   * subcategory filter. Pushed server-side via eq, like `industry`. */
  subcategory: string
}

interface Result {
  merchants: Merchant[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: Error | null
  loadMore: () => Promise<void>
  reload: () => Promise<void>
  /** Apply a local mutation to the cached list — used after inline writes so
   * the row updates without a full refetch. */
  mutate: (updater: (prev: Merchant[]) => Merchant[]) => void
}

/**
 * Keyset-paginated merchants reader. Orders by `name_lower` and pages with a
 * "name_lower > lastSeen" cursor — efficient and stable as rows change, the
 * Postgres equivalent of the previous Firestore startAfter() cursor.
 *
 * Filters that ride server-side:
 *   - `industry`    → eq('industry', x)
 *   - `subcategory` → eq('subcategory', x)
 *   - `search`      → name substring via like('name_lower', '%x%')
 */
export function usePaginatedMerchants({
  search,
  industry,
  subcategory,
}: Options): Result {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Keyset cursor: the last name_lower we've seen (paired with id to break ties).
  const cursorRef = useRef<{ nameLower: string; id: string } | null>(null)
  const queryIdRef = useRef(0)

  const runPage = useCallback(
    async (cursor: { nameLower: string; id: string } | null) => {
      const needle = search.trim().toLowerCase()
      let q = supabase.from('merchants').select('*')
      if (industry) q = q.eq('industry', industry)
      if (subcategory) q = q.eq('subcategory', subcategory)
      // Substring (contains) match so a word from the middle of a name finds it
      // — e.g. "found" matches "Not Found". name_lower is already lowercased on
      // every write, so a plain like (no ilike) is case-insensitive here.
      if (needle) q = q.like('name_lower', `%${needle}%`)
      q = q
        .order('name_lower', { ascending: true })
        .order('id', { ascending: true })
      if (cursor) {
        // Keyset: (name_lower, id) strictly greater than the cursor. Expressed
        // via Supabase's `.or` for the lexicographic tuple comparison.
        q = q.or(
          `name_lower.gt.${cursor.nameLower},and(name_lower.eq.${cursor.nameLower},id.gt.${cursor.id})`,
        )
      }
      q = q.limit(PAGE_SIZE)
      const { data, error: err } = await q
      if (err) throw new Error(err.message)
      return (data ?? []).map(mapMerchant)
    },
    [search, industry, subcategory],
  )

  const reload = useCallback(async () => {
    const myId = ++queryIdRef.current
    setLoading(true)
    setError(null)
    cursorRef.current = null
    try {
      const rows = await runPage(null)
      if (myId !== queryIdRef.current) return
      setMerchants(rows)
      setHasMore(rows.length === PAGE_SIZE)
      const last = rows[rows.length - 1]
      cursorRef.current = last ? { nameLower: last.nameLower, id: last.id } : null
    } catch (err) {
      if (myId !== queryIdRef.current) return
      setError(err as Error)
    } finally {
      if (myId === queryIdRef.current) setLoading(false)
    }
  }, [runPage])

  const loadMore = useCallback(async () => {
    if (!cursorRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      const rows = await runPage(cursorRef.current)
      setMerchants((prev) => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
      const last = rows[rows.length - 1]
      if (last) cursorRef.current = { nameLower: last.nameLower, id: last.id }
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoadingMore(false)
    }
  }, [runPage, loadingMore])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [reload])

  return {
    merchants,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    reload,
    mutate: setMerchants,
  }
}
