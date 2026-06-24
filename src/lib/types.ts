import { Timestamp } from './db'

// Re-export the Timestamp shim so existing `import { Timestamp } from '@/lib/types'`
// (and the firestore helpers) keep working after the Supabase migration.
export { Timestamp }

// Sales leadership is stored as 'Head' in the database. Some earlier records
// (and earlier code) used 'Sales Head'; it stays in the union so those docs
// type-check and keep working, but 'Head' is the canonical role we create and
// display going forward. Permission checks treat the two as identical — see
// isHead() in AuthContext.
export type Role = 'Admin' | 'Head' | 'Sales Head' | 'BD' | 'Rep' | 'Intern'

export const ROLES: Role[] = ['Admin', 'Head', 'BD', 'Rep', 'Intern']

// Seeded defaults for the `industries` collection. Admins manage the live
// list in Settings; these are the fallback used before any have been created
// and by the "restore defaults" action.
export const DEFAULT_INDUSTRIES = [
  'F&B',
  'Beauty',
  'Retail',
  'Entertainment',
  'Hospitality',
  'Tech',
  'Other',
]

export interface User {
  id: string
  name: string
  email: string
  role: Role
  color: string
  projectIds: string[]
  disabled?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

// One line of a bundle: a number of videos drawn from a specific (normal)
// project. projectName is denormalized so a bundle stays readable even if the
// referenced project is later renamed/removed.
export interface BundleItem {
  projectId: string
  projectName: string
  videos: number
}

// A package belongs to a project and comes in two shapes:
//  • Normal project → { id, videos, price } — a plain video count at a price
//    (e.g. UGC offering 10 / 20 / 30 videos).
//  • Bundle project  → { id, items, price } — a cross-project mix at one price
//    (e.g. 10 videos from UGC + 20 from Influencers).
// `videos` is set on normal packages; `items` is set on bundle packages.
// The display label is derived at render time (see packageLabel()).
export interface Package {
  id: string
  videos?: number
  items?: BundleItem[]
  price: number
  // Optional number of creators for this package. Shown only when set
  // (undefined / null = not specified, nothing displayed).
  creators?: number
}

// 'normal' = a regular project (UGC, Influencers) whose packages are plain
// video counts. 'bundle' = a project that mixes videos from several normal
// projects into a single priced package.
export type ProjectKind = 'normal' | 'bundle'

export interface Project {
  id: string
  name: string
  color: string
  description?: string
  // 'normal' (default) or 'bundle'. Defaults to 'normal' for every existing
  // project (the column defaults to 'normal' in the DB).
  kind?: ProjectKind
  // Packages an admin defined for this project. Stored as jsonb; editable any
  // time. A deal on this project may be categorized into one of these (see
  // Deal.packageId + the snapshot fields). For a bundle project this holds a
  // single cross-project package.
  packages?: Package[]
  // When true the project is finished and lives under the "Completed" view on
  // My Projects; new-work pickers hide it. Defaults to false (in progress).
  completed?: boolean
  // When the project was marked complete; cleared (undefined) when reopened.
  completedAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Stage {
  id: string
  name: string
  color: string
  order: number
  locked: boolean
  createdAt: Timestamp
}

export interface MerchantContact {
  name: string
  role: string
  phone: string
  email: string
}

// An external link for a merchant — website, social profile, online menu, etc.
// Only the url (and an optional label) are stored; the display icon is derived
// from the url's domain at render time, so it stays correct if we add more
// platforms later. See linkIconFor() in lib/linkIcons.
export interface MerchantLink {
  url: string
  label?: string
}

export interface Merchant {
  id: string
  name: string
  nameLower: string
  industry: string
  // Flat "primary" contact fields. Kept in sync with contacts[0] for the
  // merchant table, project sheet, and CSV export, which read these directly.
  contact: string
  contactRole: string
  phone: string
  email: string
  // Optional subcategory under `industry` (e.g. industry 'F&B' → 'Italian').
  // Empty string means "no subcategory" — a merchant can be categorized by
  // industry alone. Subcategories are admin-managed (see the subcategories
  // collection) and always belong to a specific industry.
  subcategory: string
  // E-commerce platform the merchant runs on (Shopify, WooCommerce, …), chosen
  // from the admin-managed `platforms` list. Empty string = none set.
  platform: string
  // Full phonebook of contacts (name + role + phone + email). Optional for
  // backward-compat with merchants created before multi-contact existed.
  contacts?: MerchantContact[]
  // External links (website, social profiles, online menu…). Optional; stored
  // as jsonb. Each link's icon is derived from its url at render time.
  links?: MerchantLink[]
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Deal {
  id: string
  merchantId: string
  merchantName: string
  projectId: string
  repId: string
  status: string
  rate: string
  comments: string
  // Which project package this lead is categorized into (e.g. the "20" UGC
  // package). Empty string = none chosen. `rate` stays independent of the
  // package price (the package price is the catalog amount; rate is the
  // negotiated deal value).
  packageId: string
  // Snapshot of the chosen package, captured at pick-time so later edits to the
  // project's package definitions never silently rewrite historical deals.
  // Undefined when no package is chosen.
  packageSnapshot?: Package
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
  updatedBy: string
}

export type ReminderType = 'missed' | 'followup' | 'manual' | 'assignment'

export interface Reminder {
  id: string
  dealId: string
  merchantId: string
  merchantName: string
  projectId: string
  repId: string
  type: ReminderType
  note: string
  dueAt: Timestamp
  dismissed: boolean
  dismissedAt?: Timestamp
  dismissedBy?: string
  createdAt: Timestamp
}

export type TaskStatus =
  | 'Pending'
  | 'In Progress'
  | 'Completed'
  | 'Not Reachable'
  | 'Not Interested'

export const TASK_STATUSES: TaskStatus[] = [
  'Pending',
  'In Progress',
  'Completed',
  'Not Reachable',
  'Not Interested',
]

export interface Task {
  id: string
  // Human-readable summary of the work — the primary identifier shown in
  // every list. Optional in the type for backward compat with older docs
  // created before this field existed; treat empty as untitled in the UI.
  title?: string
  // Merchant is now optional (a task may be generic admin work, not tied
  // to a specific merchant). Empty string means "no merchant".
  merchantId: string
  merchantName: string
  projectId: string
  assigneeId: string
  createdBy: string
  createdByName: string
  note: string
  status: TaskStatus
  statusNote?: string
  statusUpdatedAt?: Timestamp
  statusUpdatedBy?: string
  // Optional deadline. When set, the assignee sees a reminder one day out
  // and after it passes; admins see an "overdue" badge in the Tasks list.
  dueAt?: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ActivityKind =
  | 'merchant.create'
  | 'merchant.update'
  | 'merchant.delete'
  | 'deal.create'
  | 'deal.update'
  | 'deal.status'
  | 'deal.comment'
  | 'deal.delete'
  | 'deal.reassign'
  | 'reminder.create'
  | 'reminder.dismiss'
  | 'reminder.reschedule'
  | 'user.create'
  | 'user.update'
  | 'project.create'
  | 'project.update'
  | 'stage.create'
  | 'stage.update'

export interface Activity {
  id: string
  who: string
  whoName: string
  kind: ActivityKind
  text: string
  refId?: string
  refKind?: 'merchant' | 'deal' | 'reminder' | 'user' | 'project' | 'stage'
  meta?: Record<string, string | number | boolean | null>
  createdAt: Timestamp
}

export interface AuthedUser {
  uid: string
  profile: User
}

export interface Industry {
  id: string
  name: string
  // Admin-controlled display order (drag-and-drop in the Admin page). Lower
  // sorts first; ties fall back to name.
  order: number
  createdAt: Timestamp
}

export interface Subcategory {
  id: string
  name: string
  // The parent industry NAME (matches how Merchant.industry references
  // industries by name, not id).
  industry: string
  createdAt: Timestamp
}

// Admin-managed e-commerce platform a merchant runs on (Shopify, WooCommerce,
// …). A flat list (no hierarchy or ordering), referenced by name on Merchant.
export interface Platform {
  id: string
  name: string
  createdAt: Timestamp
}

export const COL = {
  users: 'users',
  projects: 'projects',
  stages: 'stages',
  merchants: 'merchants',
  deals: 'deals',
  reminders: 'reminders',
  activities: 'activities',
  tasks: 'tasks',
  industries: 'industries',
  subcategories: 'subcategories',
  platforms: 'platforms',
} as const

// ── query-constraint shim ─────────────────────────────────────────────────────
// Lightweight stand-ins for the firebase/firestore query builders the app used
// (where, orderBy, limit, …). They return plain descriptor objects that
// useCollection / the paginated readers translate into a Supabase query. This
// keeps every call site (`useCollection(COL.x, [where('a','==',b)])`) unchanged.
//
// Field names here are the CAMELCASE domain names (e.g. 'repId', 'createdAt');
// the reader maps them to snake_case columns via FIELD_TO_COLUMN below.

export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains'

export type QueryConstraint =
  | { kind: 'where'; field: string; op: WhereOp; value: unknown }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number }
  | { kind: 'startAt'; value: unknown }
  | { kind: 'endAt'; value: unknown }
  | { kind: 'startAfter'; value: unknown }

export const where = (
  field: string,
  op: WhereOp,
  value: unknown,
): QueryConstraint => ({ kind: 'where', field, op, value })

export const orderBy = (
  field: string,
  dir: 'asc' | 'desc' = 'asc',
): QueryConstraint => ({ kind: 'orderBy', field, dir })

export const limit = (n: number): QueryConstraint => ({ kind: 'limit', n })

export const startAt = (value: unknown): QueryConstraint => ({
  kind: 'startAt',
  value,
})
export const endAt = (value: unknown): QueryConstraint => ({
  kind: 'endAt',
  value,
})
export const startAfter = (value: unknown): QueryConstraint => ({
  kind: 'startAfter',
  value,
})

// Sentinel for `where(documentId(), ...)` — maps to the primary key column.
export const DOCUMENT_ID = '__name__'
export const documentId = (): string => DOCUMENT_ID

// Maps the camelCase field names used in query constraints (and the domain
// types) to the Postgres snake_case columns. Only fields actually used in
// queries/order/filter need an entry; unmapped names fall through unchanged
// (already snake or single-word).
export const FIELD_TO_COLUMN: Record<string, string> = {
  nameLower: 'name_lower',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  dueAt: 'due_at',
  repId: 'rep_id',
  assigneeId: 'assignee_id',
  merchantId: 'merchant_id',
  projectId: 'project_id',
  createdBy: 'created_by',
  [DOCUMENT_ID]: 'id',
}

export function fieldToColumn(field: string): string {
  return FIELD_TO_COLUMN[field] ?? field
}
