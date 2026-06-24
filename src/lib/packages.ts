import type { Package } from './types'

// Human-readable label for a package, derived from its contents (packages have
// no stored name). Two shapes:
//  • normal: { videos } → "10 videos"
//  • bundle: { items }  → "10 UGC + 20 Influencers"
// An optional creators count is appended only when set, e.g. "10 videos · 3
// creators".
export function packageLabel(pkg: Package): string {
  let base: string
  if (pkg.items?.length) {
    base = pkg.items
      .map((it) => `${it.videos} ${it.projectName}`.trim())
      .join(' + ')
  } else {
    const n = Number(pkg.videos) || 0
    base = `${n} ${n === 1 ? 'video' : 'videos'}`
  }
  const creators = Number(pkg.creators) || 0
  if (creators > 0) {
    base += ` · ${creators} ${creators === 1 ? 'creator' : 'creators'}`
  }
  return base
}
