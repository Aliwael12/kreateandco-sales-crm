import { supabase } from './supabase'
import { newId } from './db'
import {
  COL,
  type Package,
  type Project,
  type ProjectKind,
  type Stage,
  type User,
} from './types'

interface CreateUserPayload {
  name: string
  email: string
  password: string
  role: User['role']
  color: string
  projectIds: string[]
}

interface CreateUserResult {
  uid: string
}

/**
 * Thrown for create-user failures. Preserves the `functions/<code>` shape the
 * AdminPage UI already branches on (e.g. 'functions/already-exists'), so error
 * handling there keeps working unchanged after the Supabase migration.
 */
export class AppError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Creates a team member via the Vercel serverless endpoint at /api/createUser,
 * which uses the Supabase service-role key to create the auth account + profile
 * (privileged work that must not run in the browser).
 *
 * The signed-in admin's Supabase access token is sent as a Bearer header; the
 * server verifies it and the caller's Admin role before creating anyone.
 */
export async function createUserCallable(
  payload: CreateUserPayload,
): Promise<CreateUserResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) {
    throw new AppError(
      'functions/unauthenticated',
      'You appear to be signed out. Refresh the page and try again.',
    )
  }

  let res: Response
  try {
    res = await fetch('/api/createUser', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new AppError(
      'functions/unavailable',
      'Could not reach the server. Check your connection and try again.',
    )
  }

  if (res.status === 404) {
    throw new AppError(
      'functions/not-found',
      'The user-creation endpoint is not deployed yet. See SETUP.md.',
    )
  }

  let data: { uid?: string; error?: { code?: string; message?: string } } = {}
  try {
    data = await res.json()
  } catch {
    if (!res.ok) {
      throw new AppError('functions/internal', `Server error (${res.status}).`)
    }
  }

  if (!res.ok || data.error) {
    const code = data.error?.code ?? 'internal'
    const message = data.error?.message ?? `Request failed (${res.status}).`
    throw new AppError(`functions/${code}`, message)
  }

  if (!data.uid) {
    throw new AppError('functions/internal', 'Server did not return a user id.')
  }
  return { uid: data.uid }
}

export async function updateUser(
  uid: string,
  patch: Partial<
    Pick<User, 'name' | 'role' | 'color' | 'projectIds' | 'disabled'>
  >,
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.role !== undefined) data.role = patch.role
  if (patch.color !== undefined) data.color = patch.color
  if (patch.projectIds !== undefined) data.project_ids = patch.projectIds
  if (patch.disabled !== undefined) data.disabled = patch.disabled
  const { error } = await supabase.from(COL.users).update(data).eq('id', uid)
  if (error) throw new Error(error.message)
}

interface NewProjectInput {
  name: string
  color: string
  description?: string
  memberIds: string[]
  kind?: ProjectKind
  packages?: Package[]
}

export async function createProject(input: NewProjectInput): Promise<string> {
  const id = newId()
  const { error } = await supabase.from(COL.projects).insert({
    id,
    name: input.name.trim(),
    color: input.color,
    description: input.description?.trim() ?? '',
    kind: input.kind ?? 'normal',
    packages: input.packages ?? [],
  })
  if (error) throw new Error(error.message)
  // (Member projectIds are patched separately by the Admin UI, as before.)
  return id
}

export async function updateProject(
  projectId: string,
  // These keys all share their column names, so (like name/color/description)
  // the camelCase key maps straight to the column and can go through .update().
  patch: Partial<
    Pick<Project, 'name' | 'color' | 'description' | 'kind' | 'packages'>
  >,
): Promise<void> {
  const { error } = await supabase
    .from(COL.projects)
    .update(patch)
    .eq('id', projectId)
  if (error) throw new Error(error.message)
}

/**
 * Mark a project complete (or reopen it). Kept separate from updateProject —
 * that helper passes its patch straight to .update() assuming camelCase keys
 * already equal column names, which holds for name/color/description but NOT
 * for completed_at. We write the snake_case columns explicitly here, stamping
 * completed_at on complete and clearing it to null on reopen.
 */
export async function setProjectCompleted(
  projectId: string,
  completed: boolean,
): Promise<void> {
  const { error } = await supabase
    .from(COL.projects)
    .update({
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq('id', projectId)
  if (error) throw new Error(error.message)
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from(COL.projects)
    .delete()
    .eq('id', projectId)
  if (error) throw new Error(error.message)
}

interface NewStageInput {
  name: string
  color: string
  order: number
}

export async function createStage(input: NewStageInput): Promise<string> {
  const id = newId()
  const { error } = await supabase.from(COL.stages).insert({
    id,
    name: input.name.trim(),
    color: input.color,
    order: input.order,
    locked: false,
  })
  if (error) throw new Error(error.message)
  return id
}

export async function updateStage(
  stageId: string,
  patch: Partial<Pick<Stage, 'name' | 'color' | 'order'>>,
): Promise<void> {
  const { error } = await supabase
    .from(COL.stages)
    .update(patch)
    .eq('id', stageId)
  if (error) throw new Error(error.message)
}

export async function deleteStage(stageId: string): Promise<void> {
  const { error } = await supabase.from(COL.stages).delete().eq('id', stageId)
  if (error) throw new Error(error.message)
}

const DEFAULT_STAGES: Omit<NewStageInput, 'order'>[] = [
  { name: 'Initial Contact', color: '#6b7280' },
  { name: 'Missed Call', color: '#b87209' },
  { name: 'Follow Up', color: '#c62828' },
  { name: 'Not Interested', color: '#d63c2e' },
  { name: 'Negotiating', color: '#1565c0' },
  { name: 'Waiting for Requirements', color: '#6d28d9' },
]

const LOCKED_SIGNED = {
  name: 'Signed',
  color: '#0f9e6e',
  order: 99,
  locked: true,
}

/**
 * Seeds the default stages. Idempotent — call once when /stages is empty.
 */
export async function seedDefaultStages(): Promise<void> {
  const rows = DEFAULT_STAGES.map((s, i) => ({
    id: newId(),
    name: s.name,
    color: s.color,
    order: i,
    locked: false,
  }))
  rows.push({
    id: newId(),
    name: LOCKED_SIGNED.name,
    color: LOCKED_SIGNED.color,
    order: LOCKED_SIGNED.order,
    locked: true,
  })
  const { error } = await supabase.from(COL.stages).insert(rows)
  if (error) throw new Error(error.message)
}
