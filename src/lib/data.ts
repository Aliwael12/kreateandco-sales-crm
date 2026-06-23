// Data-write helpers for the app — all writes go to Supabase Postgres.
// (Formerly lib/firestore.ts; renamed to lib/data.ts to avoid implying any
// remaining Firestore usage — the backend is fully Supabase.)
import { supabase } from './supabase'
import { newId } from './db'
import { refreshCollectionByPath } from '@/hooks/useCollection'
import {
  COL,
  DEFAULT_INDUSTRIES,
  type ActivityKind,
  type Deal,
  type Merchant,
  type Reminder,
  type ReminderType,
  type TaskStatus,
} from './types'

/**
 * After a write, refresh the in-memory caches for the affected collections so
 * the user who made the change sees it immediately — without keeping live
 * listeners open. Fire-and-forget. (Behaviour preserved from the Firestore
 * version.)
 */
function refreshAfterWrite(...paths: string[]): void {
  void Promise.all(paths.map((p) => refreshCollectionByPath(p)))
}

/** Throw the Supabase error message (matches the old throw-on-failure shape). */
function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

interface NewDealInput {
  projectId: string
  repId: string
  createdBy: string
  defaultStatus: string
}

export async function createDeal(input: NewDealInput): Promise<string> {
  const id = newId()
  const { error } = await supabase.from(COL.deals).insert({
    id,
    merchant_id: '',
    merchant_name: '',
    project_id: input.projectId,
    rep_id: input.repId,
    status: input.defaultStatus,
    rate: '',
    comments: '',
    created_by: input.createdBy,
    updated_by: input.createdBy,
  })
  check(error)
  refreshAfterWrite(COL.deals)
  return id
}

export async function updateDealField(
  dealId: string,
  field: keyof Pick<
    Deal,
    'merchantName' | 'rate' | 'comments' | 'status' | 'repId' | 'merchantId'
  >,
  value: string,
  updatedBy: string,
): Promise<void> {
  const colMap: Record<string, string> = {
    merchantName: 'merchant_name',
    rate: 'rate',
    comments: 'comments',
    status: 'status',
    repId: 'rep_id',
    merchantId: 'merchant_id',
  }
  const { error } = await supabase
    .from(COL.deals)
    .update({ [colMap[field]]: value, updated_by: updatedBy })
    .eq('id', dealId)
  check(error)
  refreshAfterWrite(COL.deals)
}

export async function updateDealFields(
  dealId: string,
  fields: Partial<Pick<Deal, 'merchantId' | 'merchantName' | 'status'>>,
  updatedBy: string,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_by: updatedBy }
  if (fields.merchantId !== undefined) patch.merchant_id = fields.merchantId
  if (fields.merchantName !== undefined) patch.merchant_name = fields.merchantName
  if (fields.status !== undefined) patch.status = fields.status
  const { error } = await supabase.from(COL.deals).update(patch).eq('id', dealId)
  check(error)
  refreshAfterWrite(COL.deals)
}

export async function deleteDeal(dealId: string): Promise<void> {
  const { error } = await supabase.from(COL.deals).delete().eq('id', dealId)
  check(error)
  refreshAfterWrite(COL.deals)
}

interface ReassignDealInput {
  deal: Deal
  newRepId: string
  byUserId: string
  byUserName: string
  newRepName: string
}

/**
 * Reassigns a deal to a different rep AND creates an "assignment" reminder for
 * the new rep. Kept as separate writes (not a transaction) so the deal update
 * lands even if the reminder write fails — same rationale as the original.
 */
export async function reassignDeal(input: ReassignDealInput): Promise<void> {
  const { deal, newRepId, byUserId, byUserName, newRepName } = input
  const { error } = await supabase
    .from(COL.deals)
    .update({ rep_id: newRepId, updated_by: byUserId })
    .eq('id', deal.id)
  check(error)
  refreshAfterWrite(COL.deals)
  await createReminder({
    dealId: deal.id,
    merchantId: deal.merchantId,
    merchantName: deal.merchantName,
    projectId: deal.projectId,
    repId: newRepId,
    type: 'assignment',
    note: `${byUserName} assigned ${deal.merchantName || 'a deal'} to you`,
    dueAt: new Date(),
  })
  await logActivity({
    who: byUserId,
    whoName: byUserName,
    kind: 'deal.reassign',
    text: `reassigned ${deal.merchantName || 'a deal'} to ${newRepName}`,
    refId: deal.id,
    refKind: 'deal',
    meta: { projectId: deal.projectId, newRepId, oldRepId: deal.repId },
  })
}

interface NewMerchantInput {
  name: string
  industry?: string
  subcategory?: string
  contact?: string
  contactRole?: string
  phone?: string
  email?: string
  createdBy: string
}

export async function createMerchant(input: NewMerchantInput): Promise<string> {
  const name = input.name.trim()
  const id = newId()
  const { error } = await supabase.from(COL.merchants).insert({
    id,
    name,
    name_lower: name.toLowerCase(),
    industry: input.industry ?? '',
    subcategory: input.subcategory ?? '',
    contact: input.contact ?? '',
    contact_role: input.contactRole ?? '',
    phone: input.phone ?? '',
    email: input.email ?? '',
    created_by: input.createdBy,
  })
  check(error)
  refreshAfterWrite(COL.merchants)
  return id
}

export async function updateMerchant(
  merchantId: string,
  patch: Partial<
    Pick<
      Merchant,
      | 'name'
      | 'industry'
      | 'subcategory'
      | 'platform'
      | 'contact'
      | 'contactRole'
      | 'phone'
      | 'email'
      | 'contacts'
      | 'links'
    >
  >,
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    data.name = patch.name
    data.name_lower = patch.name.trim().toLowerCase()
  }
  if (patch.industry !== undefined) data.industry = patch.industry
  if (patch.subcategory !== undefined) data.subcategory = patch.subcategory
  if (patch.platform !== undefined) data.platform = patch.platform
  if (patch.contact !== undefined) data.contact = patch.contact
  if (patch.contactRole !== undefined) data.contact_role = patch.contactRole
  if (patch.phone !== undefined) data.phone = patch.phone
  if (patch.email !== undefined) data.email = patch.email
  if (patch.contacts !== undefined) data.contacts = patch.contacts
  if (patch.links !== undefined) data.links = patch.links
  const { error } = await supabase
    .from(COL.merchants)
    .update(data)
    .eq('id', merchantId)
  check(error)
  refreshAfterWrite(COL.merchants)
}

// ── industries ──────────────────────────────────────────────────────────────

export async function createIndustry(
  name: string,
  order: number,
): Promise<string> {
  const id = newId()
  const { error } = await supabase
    .from(COL.industries)
    .insert({ id, name: name.trim(), order })
  check(error)
  refreshAfterWrite(COL.industries)
  return id
}

export async function deleteIndustry(industryId: string): Promise<void> {
  const { error } = await supabase
    .from(COL.industries)
    .delete()
    .eq('id', industryId)
  check(error)
  refreshAfterWrite(COL.industries)
}

/**
 * Persist a new industry ordering after a drag-and-drop. `orderedIds` is the
 * full list of industry ids in their desired order; each row's `order` is set
 * to its index. Writes run in parallel and the cache refreshes once at the end.
 */
export async function reorderIndustries(orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from(COL.industries).update({ order: index }).eq('id', id),
    ),
  )
  for (const { error } of results) check(error)
  refreshAfterWrite(COL.industries)
}

// ── subcategories ─────────────────────────────────────────────────────────────
// Admin-managed children of an industry (e.g. industry 'F&B' → 'Italian'). A
// merchant may use just an industry, or an industry + one of its subcategories.

export async function createSubcategory(
  name: string,
  industry: string,
): Promise<string> {
  const id = newId()
  const { error } = await supabase
    .from(COL.subcategories)
    .insert({ id, name: name.trim(), industry })
  check(error)
  refreshAfterWrite(COL.subcategories)
  return id
}

export async function deleteSubcategory(subcategoryId: string): Promise<void> {
  const { error } = await supabase
    .from(COL.subcategories)
    .delete()
    .eq('id', subcategoryId)
  check(error)
  refreshAfterWrite(COL.subcategories)
}

export async function seedDefaultIndustries(): Promise<void> {
  const rows = DEFAULT_INDUSTRIES.map((name, order) => ({
    id: newId(),
    name,
    order,
  }))
  const { error } = await supabase.from(COL.industries).insert(rows)
  check(error)
  refreshAfterWrite(COL.industries)
}

// ── platforms ────────────────────────────────────────────────────────────────
// Admin-managed e-commerce platforms a merchant runs on (Shopify, WooCommerce,
// …). A flat list, mirroring industries but without ordering or children.

export async function createPlatform(name: string): Promise<string> {
  const id = newId()
  const { error } = await supabase
    .from(COL.platforms)
    .insert({ id, name: name.trim() })
  check(error)
  refreshAfterWrite(COL.platforms)
  return id
}

export async function deletePlatform(platformId: string): Promise<void> {
  const { error } = await supabase
    .from(COL.platforms)
    .delete()
    .eq('id', platformId)
  check(error)
  refreshAfterWrite(COL.platforms)
}

/**
 * Cascade-deletes a merchant and all deals attached to it. Reminders are left
 * to orphan (matching the original behavior). Caller passes deal IDs they
 * already hold.
 */
export async function deleteMerchant(
  merchantId: string,
  dealIds: string[],
): Promise<void> {
  if (dealIds.length > 0) {
    const { error: dErr } = await supabase
      .from(COL.deals)
      .delete()
      .in('id', dealIds)
    check(dErr)
  }
  const { error } = await supabase
    .from(COL.merchants)
    .delete()
    .eq('id', merchantId)
  check(error)
  refreshAfterWrite(COL.merchants, COL.deals)
}

/**
 * Find a merchant by case-insensitive name in the provided list, or create one.
 * Returns the resolved merchantId.
 */
export async function upsertMerchantByName(
  name: string,
  merchants: Merchant[],
  createdBy: string,
): Promise<string> {
  const lower = name.trim().toLowerCase()
  if (!lower) return ''
  const existing = merchants.find((m) => m.nameLower === lower)
  if (existing) return existing.id
  return createMerchant({ name, createdBy })
}

/**
 * Query-based variant that does NOT need the whole merchants collection in
 * memory. Single indexed `name_lower ==` lookup, creating one only if none.
 */
export async function upsertMerchantByNameQuery(
  name: string,
  createdBy: string,
): Promise<string> {
  const lower = name.trim().toLowerCase()
  if (!lower) return ''
  const { data, error } = await supabase
    .from(COL.merchants)
    .select('id')
    .eq('name_lower', lower)
    .limit(1)
  check(error)
  if (data && data.length > 0) return data[0].id as string
  return createMerchant({ name, createdBy })
}

interface NewReminderInput {
  dealId: string
  merchantId: string
  merchantName: string
  projectId: string
  repId: string
  type: ReminderType
  note: string
  dueAt: Date
}

export async function createReminder(input: NewReminderInput): Promise<string> {
  const id = newId()
  const { error } = await supabase.from(COL.reminders).insert({
    id,
    deal_id: input.dealId,
    merchant_id: input.merchantId,
    merchant_name: input.merchantName,
    project_id: input.projectId,
    rep_id: input.repId,
    type: input.type,
    note: input.note,
    due_at: input.dueAt.toISOString(),
    dismissed: false,
  })
  check(error)
  refreshAfterWrite(COL.reminders)
  return id
}

export async function updateReminder(
  reminderId: string,
  patch: Partial<Pick<Reminder, 'note' | 'type'>> & { dueAt?: Date },
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.note !== undefined) data.note = patch.note
  if (patch.type !== undefined) data.type = patch.type
  if (patch.dueAt !== undefined) data.due_at = patch.dueAt.toISOString()
  const { error } = await supabase
    .from(COL.reminders)
    .update(data)
    .eq('id', reminderId)
  check(error)
  refreshAfterWrite(COL.reminders)
}

export async function dismissReminder(
  reminderId: string,
  by: string,
): Promise<void> {
  const { error } = await supabase
    .from(COL.reminders)
    .update({
      dismissed: true,
      dismissed_at: new Date().toISOString(),
      dismissed_by: by,
    })
    .eq('id', reminderId)
  check(error)
  refreshAfterWrite(COL.reminders)
}

export async function rescheduleReminder(
  reminderId: string,
  newDue: Date,
): Promise<void> {
  const { error } = await supabase
    .from(COL.reminders)
    .update({ due_at: newDue.toISOString() })
    .eq('id', reminderId)
  check(error)
  refreshAfterWrite(COL.reminders)
}

// ── tasks ──────────────────────────────────────────────────────────────

interface NewTaskInput {
  title: string
  merchantId?: string
  merchantName?: string
  projectId: string
  assigneeId: string
  createdBy: string
  createdByName: string
  note: string
  dueAt?: Date | null
}

export async function createTask(input: NewTaskInput): Promise<string> {
  const id = newId()
  const { error } = await supabase.from(COL.tasks).insert({
    id,
    title: input.title,
    merchant_id: input.merchantId ?? '',
    merchant_name: input.merchantName ?? '',
    project_id: input.projectId,
    assignee_id: input.assigneeId,
    created_by: input.createdBy,
    created_by_name: input.createdByName,
    note: input.note,
    status: 'Pending' as TaskStatus,
    status_note: '',
    due_at: input.dueAt ? input.dueAt.toISOString() : null,
  })
  check(error)
  refreshAfterWrite(COL.tasks)
  return id
}

interface UpdateTaskStatusInput {
  status: TaskStatus
  statusNote?: string
  by: string
}

export async function updateTaskStatus(
  taskId: string,
  input: UpdateTaskStatusInput,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: input.status,
    status_updated_at: new Date().toISOString(),
    status_updated_by: input.by,
  }
  if (input.statusNote !== undefined) patch.status_note = input.statusNote
  const { error } = await supabase.from(COL.tasks).update(patch).eq('id', taskId)
  check(error)
  refreshAfterWrite(COL.tasks)
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from(COL.tasks).delete().eq('id', taskId)
  check(error)
  refreshAfterWrite(COL.tasks)
}

interface NewActivityInput {
  who: string
  whoName: string
  kind: ActivityKind
  text: string
  refId?: string
  refKind?: 'merchant' | 'deal' | 'reminder' | 'user' | 'project' | 'stage'
  meta?: Record<string, string | number | boolean | null>
}

/**
 * Client-side activity log writer. RLS denies inserts unless `who` == the
 * caller's uid (mirrors the old firestore.rules).
 */
export async function logActivity(input: NewActivityInput): Promise<void> {
  const { error } = await supabase.from(COL.activities).insert({
    id: newId(),
    who: input.who,
    who_name: input.whoName,
    kind: input.kind,
    text: input.text,
    ref_id: input.refId ?? null,
    ref_kind: input.refKind ?? null,
    meta: input.meta ?? null,
  })
  check(error)
  refreshAfterWrite(COL.activities)
}
