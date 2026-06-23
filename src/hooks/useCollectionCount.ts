import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Returns the row count of a table using Postgres' exact count (cheap — it does
 * not transfer the rows). Used where the UI needs a total (e.g. the dashboard
 * "merchants" metric) but not the documents themselves.
 *
 * One-shot: fetched on mount (and when `path` changes). Not realtime.
 */
export function useCollectionCount(path: string): {
  count: number
  loading: boolean
} {
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    async function run() {
      const { count: c, error } = await supabase
        .from(path)
        .select('*', { count: 'exact', head: true })
      if (cancelled) return
      setCount(error ? 0 : (c ?? 0))
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [path])

  return { count, loading }
}
