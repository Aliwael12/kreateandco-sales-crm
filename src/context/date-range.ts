import { createContext, useContext } from 'react'
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
} from 'date-fns'

export type DateRangePreset =
  | 'today'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom'

export interface DateRange {
  from: Date | null
  to: Date | null
}

export interface DateRangeCtx {
  preset: DateRangePreset
  range: DateRange
  applyPreset: (p: DateRangePreset) => void
  setFrom: (value: string) => void
  setTo: (value: string) => void
  /** Apply the current range to a Firestore Timestamp millisecond value.
   * Returns true if the timestamp falls inside the range (or there's no
   * range set). Useful for filtering arrays of deals/activities. */
  inRange: (timestampMs: number | null | undefined) => boolean
}

// Context, hook, types, and the pure `rangeFor` helper live in this
// non-component module so DateRangeContext.tsx can export ONLY the provider
// component (react-refresh/only-export-components).
export const DateRangeContext = createContext<DateRangeCtx | undefined>(
  undefined,
)

export function rangeFor(
  preset: DateRangePreset,
  anchor = new Date(),
): DateRange {
  switch (preset) {
    case 'today':
      return { from: startOfDay(anchor), to: endOfDay(anchor) }
    case 'week':
      return {
        from: startOfWeek(anchor, { weekStartsOn: 1 }),
        to: endOfWeek(anchor, { weekStartsOn: 1 }),
      }
    case 'month':
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) }
    case 'quarter':
      return { from: startOfQuarter(anchor), to: endOfQuarter(anchor) }
    case 'year':
      return { from: startOfYear(anchor), to: endOfYear(anchor) }
    case 'all':
    case 'custom':
      return { from: null, to: null }
  }
}

export function useDateRange(): DateRangeCtx {
  const ctx = useContext(DateRangeContext)
  if (!ctx)
    throw new Error('useDateRange must be inside <DateRangeProvider>')
  return ctx
}
