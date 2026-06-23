import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { mapMerchant } from '@/lib/db'
import { type Merchant } from '@/lib/types'

// Postgres `in (...)` has no small fixed cap like Firestore's 30, but we keep a
// chunk size to avoid pathologically long URLs on huge id sets.
const IN_CHUNK = 200

/**
 * Fetches ONLY the merchant rows referenced by the given ids, instead of
 * loading the entire merchants table. Keeps reads proportional to what's on
 * screen. Returns a Map keyed by merchant id, plus a `refresh()`.
 */
export function useMerchantsByIds(ids: string[]): {
  merchantsById: Map<string, Merchant>
  loading: boolean
  refresh: () => void
} {
  const [merchantsById, setMerchantsById] = useState<Map<string, Merchant>>(
    new Map(),
  )
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const unique = Array.from(new Set(ids.filter(Boolean))).sort()
  const key = unique.join(',')

  useEffect(() => {
    if (unique.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMerchantsById(new Map())
      return
    }
    let cancelled = false
    setLoading(true)

    async function run() {
      const map = new Map<string, Merchant>()
      try {
        for (let i = 0; i < unique.length; i += IN_CHUNK) {
          const chunk = unique.slice(i, i + IN_CHUNK)
          const { data, error } = await supabase
            .from('merchants')
            .select('*')
            .in('id', chunk)
          if (error) throw new Error(error.message)
          for (const row of data ?? []) {
            const m = mapMerchant(row)
            map.set(m.id, m)
          }
        }
        if (!cancelled) setMerchantsById(map)
      } catch {
        if (!cancelled) setMerchantsById(new Map())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  return {
    merchantsById,
    loading,
    refresh: () => setNonce((n) => n + 1),
  }
}
