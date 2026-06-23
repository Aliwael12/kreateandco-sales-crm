import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MAPPERS } from '@/lib/db'
import { fieldToColumn, type QueryConstraint } from '@/lib/types'

interface State<T> {
  data: T[]
  loading: boolean
  error: Error | null
  /** Re-fetch this collection from Supabase. Use after a write, on a manual
   * refresh button, or when a page re-mounts to pull the latest data. */
  refresh: () => Promise<void>
}

/**
 * Process-wide collection cache. We do NOT keep live subscriptions: the app
 * does not need to be realtime, and persistent listeners were the main driver
 * of read-quota exhaustion on Firestore. We keep the same posture on Supabase —
 * each query is fetched ONCE and cached here in memory, served for free on
 * remount until something explicitly calls `refresh()`.
 *
 * Multiple components mounting the same query share one cache entry (and one
 * in-flight fetch). Entries are reference-counted and disposed shortly after
 * the last subscriber unmounts. (Behaviour preserved verbatim from the
 * Firestore version — only the fetch itself changed.)
 */
interface CacheEntry {
  data: unknown[]
  loading: boolean
  error: Error | null
  refCount: number
  /** Collection path + constraints, so refresh() can re-run the query. */
  path: string
  constraints: QueryConstraint[]
  inFlight: Promise<void> | null
  fetched: boolean
  disposeTimer: ReturnType<typeof setTimeout> | null
  listeners: Set<() => void>
}

const cache = new Map<string, CacheEntry>()
const DISPOSE_DELAY_MS = 10 * 60_000

function notify(entry: CacheEntry) {
  entry.listeners.forEach((fn) => fn())
}

// U+F8FF sentinel used by the old Firestore prefix searches (startAt/endAt on
// nameLower). For Postgres we translate a [startAt(x), endAt(x+sentinel)] pair
// into a prefix LIKE, so this constant lets us detect that pattern.
const HIGH_SENTINEL = String.fromCharCode(0xf8ff)

/** Build a Supabase query from the constraint descriptors. Returns a FRESH
 * builder each call so it can be re-issued per page during pagination (a
 * PostgREST builder resolves once, so we must rebuild it for each .range()). */
function buildQuery(path: string, constraints: QueryConstraint[]) {
  let q = supabase.from(path).select('*')

  // Detect a Firestore-style prefix search: orderBy(f) + startAt(s) + endAt(s+sentinel).
  const startAtC = constraints.find((c) => c.kind === 'startAt')
  const endAtC = constraints.find((c) => c.kind === 'endAt')
  let prefixField: string | null = null
  let prefixNeedle: string | null = null
  if (
    startAtC?.kind === 'startAt' &&
    endAtC?.kind === 'endAt' &&
    typeof startAtC.value === 'string' &&
    typeof endAtC.value === 'string' &&
    endAtC.value === startAtC.value + HIGH_SENTINEL
  ) {
    const ob = constraints.find((c) => c.kind === 'orderBy')
    prefixField = ob?.kind === 'orderBy' ? fieldToColumn(ob.field) : null
    prefixNeedle = startAtC.value
  }

  for (const c of constraints) {
    switch (c.kind) {
      case 'where': {
        const col = fieldToColumn(c.field)
        switch (c.op) {
          case '==':
            q = q.eq(col, c.value as never)
            break
          case '!=':
            q = q.neq(col, c.value as never)
            break
          case '<':
            q = q.lt(col, c.value as never)
            break
          case '<=':
            q = q.lte(col, c.value as never)
            break
          case '>':
            q = q.gt(col, c.value as never)
            break
          case '>=':
            q = q.gte(col, c.value as never)
            break
          case 'in':
            q = q.in(col, c.value as never[])
            break
          case 'array-contains':
            q = q.contains(col, [c.value] as never)
            break
        }
        break
      }
      case 'orderBy':
        q = q.order(fieldToColumn(c.field), { ascending: c.dir === 'asc' })
        break
      case 'limit':
        q = q.limit(c.n)
        break
      // startAt/endAt handled via the prefix detection above (and ignored
      // otherwise — the app only uses them for the prefix-search pattern).
    }
  }

  if (prefixField && prefixNeedle !== null) {
    // Case-insensitive prefix match (the needle is already lowercased by the
    // callers, and the column is name_lower, so a plain like is exact).
    q = q.like(prefixField, `${prefixNeedle}%`)
  }

  return q
}

/** Build and run the query, paginating to defeat PostgREST's max_rows cap. */
async function fetchRows(
  path: string,
  constraints: QueryConstraint[],
): Promise<unknown[]> {
  const map = MAPPERS[path]

  // If the caller set an explicit limit (e.g. ActivitiesPage wants 200), honor
  // it with a single request — no pagination needed or wanted.
  const explicitLimit = constraints.find((c) => c.kind === 'limit')
  if (explicitLimit) {
    const { data, error } = await buildQuery(path, constraints)
    if (error) throw new Error(error.message)
    return map ? (data ?? []).map(map) : (data ?? [])
  }

  // Otherwise PAGINATE. Supabase/PostgREST caps a single response at `max_rows`,
  // which would SILENTLY drop rows from any collection larger than that — e.g. a
  // manager's 3,700 deals would return only the first page, hiding the rest (and
  // their merchants, which My Projects derives from the loaded deals). We page
  // with .range() until a short page signals the end, so the full set always
  // loads regardless of the server cap. A fresh builder is created per page
  // because a PostgREST builder resolves only once.
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(path, constraints).range(
      from,
      from + PAGE - 1,
    )
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as Record<string, unknown>[]
    all.push(...batch)
    if (batch.length < PAGE) break // last (short) page → done
  }
  return map ? all.map(map) : all
}

function runFetch(entry: CacheEntry): Promise<void> {
  if (entry.inFlight) return entry.inFlight
  entry.loading = true
  notify(entry)
  const p = fetchRows(entry.path, entry.constraints)
    .then((rows) => {
      entry.data = rows
      entry.error = null
      entry.fetched = true
    })
    .catch((err: Error) => {
      entry.error = err
    })
    .finally(() => {
      entry.loading = false
      entry.inFlight = null
      notify(entry)
    })
  entry.inFlight = p
  return p
}

function ensureEntry(
  key: string,
  path: string,
  constraints: QueryConstraint[],
): CacheEntry {
  const existing = cache.get(key)
  if (existing) {
    if (existing.disposeTimer) {
      clearTimeout(existing.disposeTimer)
      existing.disposeTimer = null
    }
    return existing
  }
  const entry: CacheEntry = {
    data: [],
    loading: true,
    error: null,
    refCount: 0,
    path,
    constraints,
    inFlight: null,
    fetched: false,
    disposeTimer: null,
    listeners: new Set(),
  }
  cache.set(key, entry)
  void runFetch(entry)
  return entry
}

export function refreshCollection(key: string): Promise<void> {
  const entry = cache.get(key)
  if (!entry) return Promise.resolve()
  return runFetch(entry)
}

export function refreshCollectionByPath(path: string): Promise<void> {
  const prefix = path + ':'
  const targets: CacheEntry[] = []
  for (const [key, entry] of cache.entries()) {
    if (key === path || key.startsWith(prefix)) targets.push(entry)
  }
  return Promise.all(targets.map((e) => runFetch(e))).then(() => undefined)
}

export function refreshAllCollections(): Promise<void> {
  return Promise.all([...cache.values()].map((e) => runFetch(e))).then(
    () => undefined,
  )
}

export function useCollection<T extends { id: string }>(
  path: string,
  constraints: QueryConstraint[] = [],
  cacheKey?: string,
): State<T> {
  if (constraints.length > 0 && !cacheKey) {
    throw new Error(
      `useCollection(${path}): non-empty constraints require an explicit cacheKey`,
    )
  }
  const key = cacheKey ?? path
  const [, forceRender] = useState(0)

  useEffect(() => {
    const entry = ensureEntry(key, path, constraints)
    entry.refCount += 1
    const rerender = () => forceRender((x) => x + 1)
    entry.listeners.add(rerender)
    // Cache-FIRST: once fetched, remounting serves cached data with zero new
    // reads. Only kick a fetch if this entry has never loaded.
    if (!entry.fetched && !entry.inFlight) void runFetch(entry)
    rerender()
    return () => {
      entry.listeners.delete(rerender)
      entry.refCount -= 1
      if (entry.refCount <= 0) {
        entry.disposeTimer = setTimeout(() => {
          if (entry.refCount > 0) return
          cache.delete(key)
        }, DISPOSE_DELAY_MS)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const entry = cache.get(key)
  return {
    data: (entry?.data ?? []) as T[],
    loading: entry?.loading ?? true,
    error: entry?.error ?? null,
    refresh: () => refreshCollection(key),
  }
}
