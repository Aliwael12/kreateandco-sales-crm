// ============================================================================
// Supabase data-access layer: the Timestamp compatibility shim + row mappers.
//
// WHY THIS EXISTS
// ---------------
// The app was written against Firestore, where timestamp fields are `Timestamp`
// objects with `.toDate()` / `.toMillis()`, and documents come back in
// camelCase. Postgres returns ISO strings and snake_case columns. To migrate
// WITHOUT rewriting dozens of components, this module:
//   • provides a `Timestamp` class with the same surface the UI already calls
//     (toDate, toMillis, fromDate, fromMillis, now), and
//   • maps each table's snake_case row → the exact camelCase shape from
//     src/lib/types.ts, with timestamp columns wrapped as Timestamp.
//
// Components keep using `deal.createdAt.toDate()` etc. unchanged.
// ============================================================================

import type {
  Activity,
  Deal,
  Industry,
  Merchant,
  Package,
  Platform,
  Project,
  Reminder,
  Stage,
  Subcategory,
  Task,
  User,
} from './types'

// ── Timestamp shim ───────────────────────────────────────────────────────────
// Drop-in for firebase/firestore's Timestamp, covering every method the app
// uses. Backed by a JS Date.
export class Timestamp {
  private readonly _date: Date
  constructor(date: Date) {
    this._date = date
  }
  toDate(): Date {
    return this._date
  }
  toMillis(): number {
    return this._date.getTime()
  }
  get seconds(): number {
    return Math.floor(this._date.getTime() / 1000)
  }
  toISOString(): string {
    return this._date.toISOString()
  }
  static fromDate(d: Date): Timestamp {
    return new Timestamp(d)
  }
  static fromMillis(ms: number): Timestamp {
    return new Timestamp(new Date(ms))
  }
  static now(): Timestamp {
    return new Timestamp(new Date())
  }
}

/** Wrap a Postgres timestamptz string (or null) as a Timestamp | null. */
export function ts(value: string | null | undefined): Timestamp | null {
  if (!value) return null
  return new Timestamp(new Date(value))
}

// ── new-document ID generator ─────────────────────────────────────────────────
// Firestore auto-IDs were 20-char base62 strings; new rows we create keep the
// same shape so IDs stay visually consistent and remain valid `text` PKs. Uses
// crypto for collision resistance.
const ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function newId(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 20; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  return out
}

/** Non-null variant for columns the schema guarantees are present. */
function tsReq(value: string | null | undefined): Timestamp {
  return new Timestamp(value ? new Date(value) : new Date())
}

// ── row → domain mappers ─────────────────────────────────────────────────────
// Each takes a raw Supabase row (snake_case) and returns the camelCase domain
// object the UI expects. `id` is preserved verbatim. user-reference columns are
// UUIDs (uuidv5 of the old Firebase UID) — the app treats them as opaque ids,
// which they still are, so nothing downstream changes.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

export function mapUser(r: Row): User {
  return {
    id: r.id,
    name: r.name ?? '',
    email: r.email ?? '',
    role: r.role,
    color: r.color ?? '#5B4FCF',
    projectIds: r.project_ids ?? [],
    disabled: r.disabled ?? false,
    createdAt: tsReq(r.created_at),
    updatedAt: tsReq(r.updated_at),
  } as User
}

export function mapProject(r: Row): Project {
  return {
    id: r.id,
    name: r.name ?? '',
    color: r.color ?? '',
    description: r.description ?? '',
    kind: r.kind === 'bundle' ? 'bundle' : 'normal',
    // jsonb → already-parsed array (Supabase deserializes jsonb). Default to []
    // for projects created before packages existed.
    packages: Array.isArray(r.packages) ? (r.packages as Package[]) : [],
    completed: r.completed ?? false,
    completedAt: ts(r.completed_at) ?? undefined,
    createdAt: tsReq(r.created_at),
    updatedAt: tsReq(r.updated_at),
  } as Project
}

export function mapStage(r: Row): Stage {
  return {
    id: r.id,
    name: r.name ?? '',
    color: r.color ?? '',
    order: r.order ?? 0,
    locked: r.locked ?? false,
    createdAt: tsReq(r.created_at),
  } as Stage
}

export function mapMerchant(r: Row): Merchant {
  return {
    id: r.id,
    name: r.name ?? '',
    nameLower: r.name_lower ?? '',
    industry: r.industry ?? '',
    contact: r.contact ?? '',
    contactRole: r.contact_role ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    subcategory: r.subcategory ?? '',
    platform: r.platform ?? '',
    contacts: r.contacts ?? undefined,
    links: r.links ?? undefined,
    createdBy: r.created_by ?? '',
    createdAt: tsReq(r.created_at),
    updatedAt: tsReq(r.updated_at),
  } as Merchant
}

export function mapDeal(r: Row): Deal {
  return {
    id: r.id,
    merchantId: r.merchant_id ?? '',
    merchantName: r.merchant_name ?? '',
    projectId: r.project_id ?? '',
    repId: r.rep_id ?? '',
    status: r.status ?? '',
    rate: r.rate ?? '',
    comments: r.comments ?? '',
    packageId: r.package_id ?? '',
    packageSnapshot: (r.package_snapshot as Package | null) ?? undefined,
    createdBy: r.created_by ?? '',
    updatedBy: r.updated_by ?? '',
    createdAt: tsReq(r.created_at),
    updatedAt: tsReq(r.updated_at),
  } as Deal
}

export function mapReminder(r: Row): Reminder {
  return {
    id: r.id,
    dealId: r.deal_id ?? '',
    merchantId: r.merchant_id ?? '',
    merchantName: r.merchant_name ?? '',
    projectId: r.project_id ?? '',
    repId: r.rep_id ?? '',
    type: r.type,
    note: r.note ?? '',
    dueAt: tsReq(r.due_at),
    dismissed: r.dismissed ?? false,
    dismissedAt: ts(r.dismissed_at) ?? undefined,
    dismissedBy: r.dismissed_by ?? undefined,
    createdAt: tsReq(r.created_at),
  } as Reminder
}

export function mapTask(r: Row): Task {
  return {
    id: r.id,
    title: r.title ?? '',
    merchantId: r.merchant_id ?? '',
    merchantName: r.merchant_name ?? '',
    projectId: r.project_id ?? '',
    assigneeId: r.assignee_id ?? '',
    createdBy: r.created_by ?? '',
    createdByName: r.created_by_name ?? '',
    note: r.note ?? '',
    status: r.status,
    statusNote: r.status_note ?? '',
    statusUpdatedAt: ts(r.status_updated_at) ?? undefined,
    statusUpdatedBy: r.status_updated_by ?? undefined,
    dueAt: ts(r.due_at),
    createdAt: tsReq(r.created_at),
    updatedAt: tsReq(r.updated_at),
  } as Task
}

export function mapIndustry(r: Row): Industry {
  return {
    id: r.id,
    name: r.name ?? '',
    order: r.order ?? 0,
    createdAt: tsReq(r.created_at),
  } as Industry
}

export function mapSubcategory(r: Row): Subcategory {
  return {
    id: r.id,
    name: r.name ?? '',
    industry: r.industry ?? '',
    createdAt: tsReq(r.created_at),
  } as Subcategory
}

export function mapPlatform(r: Row): Platform {
  return {
    id: r.id,
    name: r.name ?? '',
    createdAt: tsReq(r.created_at),
  } as Platform
}

export function mapActivity(r: Row): Activity {
  return {
    id: r.id,
    who: r.who ?? '',
    whoName: r.who_name ?? '',
    kind: r.kind,
    text: r.text ?? '',
    refId: r.ref_id ?? undefined,
    refKind: r.ref_kind ?? undefined,
    meta: r.meta ?? undefined,
    createdAt: tsReq(r.created_at),
  } as Activity
}

// Lookup by collection name (the COL constants) so generic readers can pick the
// right mapper. Keys match src/lib/types.ts COL values.
export const MAPPERS: Record<string, (r: Row) => { id: string }> = {
  users: mapUser,
  projects: mapProject,
  stages: mapStage,
  merchants: mapMerchant,
  deals: mapDeal,
  reminders: mapReminder,
  tasks: mapTask,
  industries: mapIndustry,
  subcategories: mapSubcategory,
  platforms: mapPlatform,
  activities: mapActivity,
}
