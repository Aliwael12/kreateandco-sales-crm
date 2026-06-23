import { useMemo, useState, type ReactNode } from 'react'
import { startOfDay, endOfDay } from 'date-fns'
import {
  DateRangeContext,
  rangeFor,
  type DateRange,
  type DateRangePreset,
} from '@/context/date-range'

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<DateRangePreset>('all')
  const [range, setRange] = useState<DateRange>(rangeFor('all'))

  function applyPreset(p: DateRangePreset) {
    setPreset(p)
    setRange(rangeFor(p))
  }

  function setFrom(value: string) {
    const d = value ? startOfDay(new Date(value)) : null
    setRange((r) => ({ ...r, from: d }))
    setPreset('custom')
  }

  function setTo(value: string) {
    const d = value ? endOfDay(new Date(value)) : null
    setRange((r) => ({ ...r, to: d }))
    setPreset('custom')
  }

  const inRange = useMemo(() => {
    return (ms: number | null | undefined) => {
      if (!range.from && !range.to) return true
      if (ms == null) return false
      if (range.from && ms < range.from.getTime()) return false
      if (range.to && ms > range.to.getTime()) return false
      return true
    }
  }, [range.from, range.to])

  return (
    <DateRangeContext.Provider
      value={{ preset, range, applyPreset, setFrom, setTo, inRange }}
    >
      {children}
    </DateRangeContext.Provider>
  )
}
