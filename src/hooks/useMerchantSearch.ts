import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mapMerchant } from '@/lib/db'
import { type Merchant } from '@/lib/types'

const MIN_CHARS = 3
const MAX_HITS = 8
const DEBOUNCE_MS = 250

/**
 * On-demand merchant search for the global Topbar box. Queries Supabase only
 * once the user has typed at least 3 characters, debounced, returning at most 8
 * substring matches on `name_lower`. A handful of rows per search instead of the
 * full table per session.
 *
 * Matches anywhere in the name (substring), so a word from the middle finds it
 * — e.g. "found" matches "Not Found".
 */
export function useMerchantSearch(term: string): {
  hits: Merchant[]
  loading: boolean
} {
  const [hits, setHits] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const needle = term.trim().toLowerCase()
    /* eslint-disable react-hooks/set-state-in-effect */
    if (needle.length < MIN_CHARS) {
      setHits([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    const handle = setTimeout(async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .like('name_lower', `%${needle}%`)
        .order('name_lower', { ascending: true })
        .limit(MAX_HITS)
      if (cancelled) return
      if (error) {
        setHits([])
      } else {
        setHits((data ?? []).map(mapMerchant))
      }
      setLoading(false)
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [term])

  return { hits, loading }
}
