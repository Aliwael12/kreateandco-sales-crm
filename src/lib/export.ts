/**
 * Build a CSV string from a row matrix and trigger a download.
 * Cells are escaped per RFC 4180: wrap in quotes, double-up internal quotes.
 */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? '')
          return `"${s.replace(/"/g, '""')}"`
        })
        .join(','),
    )
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
