/// <reference types="node" />
// Vercel Serverless Function — POST /api/createUser
//
// The node types reference above ensures `process` (and other Node globals) are
// typed when Vercel compiles this function in isolation — Vercel does NOT use
// the repo's tsconfig.api.json project reference, so without this the build
// fails with "Cannot find name 'process'".
//
// Replaces the Firebase Admin SDK version. Creates a Supabase Auth account +
// the public.users profile row, using the service-role key (which bypasses RLS,
// the same way the Firebase Admin SDK bypassed firestore.rules). The
// service-role key never reaches the browser — it lives only in the
// SUPABASE_SERVICE_ROLE_KEY env var on Vercel.
//
// Auth model: the browser sends the signed-in user's Supabase access token as a
// Bearer token. We verify it, then confirm that user's profile has role ===
// 'Admin' (and is not disabled) before doing anything.
//
// IMPORTANT — id mapping. To match the migrated data, where public.users.id ==
// auth.users.id and historical user references are uuidv5(firebaseUid), NEW
// users simply use the UUID Supabase generates for the auth account. Both the
// auth row and the profile row share that id; there is no Firebase UID for a
// net-new user, so no v5 mapping is needed.
//
// Required Vercel env vars:
//   SUPABASE_URL                — https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — Project Settings → API → service_role secret

import { createClient } from '@supabase/supabase-js'

const ALLOWED_ROLES = ['Admin', 'Head', 'Sales Head', 'BD', 'Rep', 'Intern'] as const
type Role = (typeof ALLOWED_ROLES)[number]

interface CreateUserBody {
  name?: unknown
  email?: unknown
  password?: unknown
  role?: unknown
  color?: unknown
  projectIds?: unknown
}

interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}
interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
  setHeader(name: string, value: string): void
  end(): void
}

function admin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars are not set. ' +
        'Add them in Vercel → Project Settings → Environment Variables.',
    )
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

interface ValidInput {
  name: string
  email: string
  password: string
  role: Role
  color: string
  projectIds: string[]
}

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message)
  }
}

function validate(body: CreateUserBody): ValidInput {
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const role = body.role as Role
  const color = String(body.color ?? '#5B4FCF')
  const projectIds = Array.isArray(body.projectIds)
    ? body.projectIds.map((p) => String(p))
    : []

  if (!name) throw new HttpError(400, 'invalid-argument', 'Name required.')
  if (!email.includes('@'))
    throw new HttpError(400, 'invalid-argument', 'Valid email required.')
  if (password.length < 8)
    throw new HttpError(400, 'invalid-argument', 'Password must be at least 8 characters.')
  if (!ALLOWED_ROLES.includes(role))
    throw new HttpError(400, 'invalid-argument', `Invalid role: ${role}`)

  return { name, email, password, role, color, projectIds }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } })
    return
  }

  try {
    const supa = admin()

    // 1. Authenticate the caller via their Supabase access token.
    const authHeader = req.headers['authorization']
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
    const token = headerValue?.startsWith('Bearer ')
      ? headerValue.slice('Bearer '.length).trim()
      : ''
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required.')

    const { data: userData, error: getUserErr } = await supa.auth.getUser(token)
    if (getUserErr || !userData.user) {
      throw new HttpError(401, 'unauthenticated', 'Your session is invalid. Sign in again.')
    }
    const callerId = userData.user.id

    // 2. Authorize: caller's profile must exist, be Admin, and not be disabled.
    const { data: caller, error: callerErr } = await supa
      .from('users')
      .select('role, disabled')
      .eq('id', callerId)
      .maybeSingle()
    if (callerErr) throw new HttpError(500, 'internal', 'Could not verify your account.')
    if (!caller || caller.role !== 'Admin') {
      throw new HttpError(403, 'permission-denied', 'Only admins can perform this action.')
    }
    if (caller.disabled === true) {
      throw new HttpError(403, 'permission-denied', 'Your account is disabled.')
    }

    // 3. Validate the payload.
    let body: CreateUserBody
    try {
      body =
        typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : ((req.body as CreateUserBody) ?? {})
    } catch {
      throw new HttpError(400, 'invalid-argument', 'Request body was not valid JSON.')
    }
    const input = validate(body)

    // 4. Create the Auth account (email pre-confirmed so they can sign in).
    const { data: created, error: createErr } = await supa.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
    })
    if (createErr || !created.user) {
      const msg = createErr?.message ?? ''
      if (/already.*registered|already.*exists|duplicate/i.test(msg)) {
        throw new HttpError(409, 'already-exists', 'A user with that email already exists.')
      }
      throw new HttpError(500, 'internal', `Could not create the account: ${msg}`)
    }
    const uid = created.user.id

    // 5. Write the profile row. On failure, delete the orphaned auth user so a
    //    retry doesn't hit email-already-exists.
    const { error: profileErr } = await supa.from('users').insert({
      id: uid,
      name: input.name,
      email: input.email,
      role: input.role,
      color: input.color,
      project_ids: input.projectIds,
      disabled: false,
    })
    if (profileErr) {
      await supa.auth.admin.deleteUser(uid).catch(() => {})
      throw new HttpError(500, 'internal', `Could not save the profile: ${profileErr.message}`)
    }

    res.status(200).json({ uid })
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message } })
      return
    }
    console.error('createUser: unexpected error', err)
    res.status(500).json({
      error: { code: 'internal', message: 'Unexpected server error. Please try again.' },
    })
  }
}
