import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { Resend } from 'resend'

initializeApp()

// 'Head' is the canonical sales-leadership role; 'Sales Head' stays accepted
// for any legacy records/clients still sending it.
const ALLOWED_ROLES = ['Admin', 'Head', 'Sales Head', 'BD', 'Rep', 'Intern'] as const
type Role = (typeof ALLOWED_ROLES)[number]

const RESEND_API_KEY = defineSecret('RESEND_API_KEY')
const DIGEST_FROM_EMAIL = defineSecret('DIGEST_FROM_EMAIL')

// ── createUser ─────────────────────────────────────────────────────────────

interface CreateUserInput {
  name: string
  email: string
  password: string
  role: Role
  color: string
  projectIds: string[]
}

interface CreateUserResult {
  uid: string
}

async function assertCallerIsAdmin(req: CallableRequest): Promise<void> {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.')
  }
  const snap = await getFirestore('default').doc(`users/${req.auth.uid}`).get()
  const data = snap.data()
  if (!snap.exists || data?.role !== 'Admin') {
    throw new HttpsError(
      'permission-denied',
      'Only admins can perform this action.',
    )
  }
}

function validateCreateUser(input: unknown): CreateUserInput {
  if (!input || typeof input !== 'object') {
    throw new HttpsError('invalid-argument', 'Payload required.')
  }
  const obj = input as Record<string, unknown>
  const name = String(obj.name ?? '').trim()
  const email = String(obj.email ?? '').trim().toLowerCase()
  const password = String(obj.password ?? '')
  const role = obj.role as Role
  const color = String(obj.color ?? '#5B4FCF')
  const projectIds = Array.isArray(obj.projectIds)
    ? obj.projectIds.map((p) => String(p))
    : []
  if (!name) throw new HttpsError('invalid-argument', 'Name required.')
  if (!email.includes('@'))
    throw new HttpsError('invalid-argument', 'Valid email required.')
  if (password.length < 8)
    throw new HttpsError(
      'invalid-argument',
      'Password must be at least 8 characters.',
    )
  if (!ALLOWED_ROLES.includes(role))
    throw new HttpsError('invalid-argument', `Invalid role: ${role}`)
  return { name, email, password, role, color, projectIds }
}

export const createUser = onCall<CreateUserInput, Promise<CreateUserResult>>(
  { region: 'us-central1' },
  async (req) => {
    await assertCallerIsAdmin(req)
    const input = validateCreateUser(req.data)

    let userRecord
    try {
      userRecord = await getAuth().createUser({
        email: input.email,
        password: input.password,
        displayName: input.name,
        emailVerified: false,
        disabled: false,
      })
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'A user with that email already exists.')
      }
      if (code === 'auth/invalid-password') {
        throw new HttpsError('invalid-argument', 'Password must be at least 6 characters and meet Firebase requirements.')
      }
      if (code === 'auth/invalid-email') {
        throw new HttpsError('invalid-argument', 'The email address is not valid.')
      }
      logger.error('createUser: Auth createUser failed', err)
      throw new HttpsError('internal', `Failed to create the auth account: ${(err as Error)?.message ?? String(err)}`)
    }

    try {
      const db = getFirestore('default')
      const now = FieldValue.serverTimestamp()
      await db.doc(`users/${userRecord.uid}`).set({
        name: input.name,
        email: input.email,
        role: input.role,
        color: input.color,
        projectIds: input.projectIds,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      })

      await db.collection('activities').add({
        who: req.auth!.uid,
        whoName: '',
        kind: 'user.create',
        text: `created team member ${input.name} (${input.role})`,
        refId: userRecord.uid,
        refKind: 'user',
        createdAt: now,
      })
    } catch (err) {
      // Roll back the orphaned Auth account so a retry doesn't hit
      // email-already-exists, then surface the real Firestore error.
      await getAuth().deleteUser(userRecord.uid).catch(() => {})
      logger.error('createUser: Firestore write failed', err)
      throw new HttpsError('internal', `Auth account created but saving the profile failed: ${(err as Error)?.message ?? String(err)}`)
    }

    return { uid: userRecord.uid }
  },
)

// ── dailyReminderDigest ────────────────────────────────────────────────────
//
// Runs every day at 09:00 Africa/Cairo. For each user with active reminders
// due today or overdue, sends a single email via Resend listing them.
//
// Required secrets:
//   firebase functions:secrets:set RESEND_API_KEY
//   firebase functions:secrets:set DIGEST_FROM_EMAIL   # e.g. "kreateandco <crm@your-verified-domain.com>"
//

interface ReminderRow {
  merchantName: string
  projectName: string
  type: string
  note: string
  dueAt: Date
  status?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderEmail(name: string, rows: ReminderRow[]): string {
  const now = new Date()
  const rowsHtml = rows
    .map((r) => {
      const overdue = r.dueAt < now
      const due = r.dueAt.toLocaleString('en-GB', {
        timeZone: 'Africa/Cairo',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
      const urgencyColor = overdue ? '#d63c2e' : '#b87209'
      const urgencyLabel = overdue ? 'OVERDUE' : 'DUE'
      return `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e4ee;font-family:system-ui,sans-serif;font-size:13px;color:#0b1f4b;">
            <div style="font-weight:600">${escapeHtml(r.merchantName)}</div>
            <div style="font-size:11.5px;color:#8a90b8;margin-top:2px">${escapeHtml(r.projectName)} · ${escapeHtml(r.type)}${r.status ? ' · ' + escapeHtml(r.status) : ''}</div>
            <div style="font-size:12px;color:#4a527a;margin-top:4px">${escapeHtml(r.note)}</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e4ee;font-family:system-ui,sans-serif;font-size:12px;text-align:right;color:${urgencyColor};font-weight:600;white-space:nowrap;">
            ${urgencyLabel}<br/>${due}
          </td>
        </tr>`
    })
    .join('')

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f9;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f5f9;padding:30px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="background:white;border-radius:16px;overflow:hidden;font-family:system-ui,sans-serif;">
        <tr>
          <td style="background:#5B4FCF;color:white;padding:24px 28px;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7;">Kreate&co Sales Platform</div>
            <div style="font-size:20px;font-weight:700;margin-top:4px;">Your reminders for today</div>
            <div style="font-size:13px;opacity:.85;margin-top:2px;">Hi ${escapeHtml(name)} — ${rows.length} item${rows.length === 1 ? '' : 's'} to handle today.</div>
          </td>
        </tr>
        <tr><td><table cellpadding="0" cellspacing="0" border="0" width="100%">${rowsHtml}</table></td></tr>
        <tr>
          <td style="padding:18px 28px 24px;font-family:system-ui,sans-serif;font-size:12px;color:#8a90b8;text-align:center;">
            Open the app to handle these →
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

interface UserDoc {
  id: string
  name: string
  email: string
  disabled?: boolean
}

interface ReminderDoc {
  id: string
  dealId: string
  merchantName: string
  projectId: string
  repId: string
  type: string
  note: string
  dueAt: FirebaseFirestore.Timestamp
  dismissed: boolean
}

interface DealDoc {
  id: string
  status: string
}

export const dailyReminderDigest = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Africa/Cairo',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, DIGEST_FROM_EMAIL],
  },
  async () => {
    const db = getFirestore('default')
    const resend = new Resend(RESEND_API_KEY.value())
    const fromAddr = DIGEST_FROM_EMAIL.value()

    // End-of-today in Cairo, as a UTC instant
    const now = new Date()
    const cairoNow = new Date(
      now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
    )
    const endOfToday = new Date(cairoNow)
    endOfToday.setHours(23, 59, 59, 999)
    const cutoffMs = endOfToday.getTime() + (now.getTime() - cairoNow.getTime())
    const cutoff = new Date(cutoffMs)

    const [usersSnap, remindersSnap, projectsSnap] = await Promise.all([
      db.collection('users').get(),
      db
        .collection('reminders')
        .where('dismissed', '==', false)
        .where('dueAt', '<=', cutoff)
        .get(),
      db.collection('projects').get(),
    ])

    const users: UserDoc[] = usersSnap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<UserDoc, 'id'>) }),
    )
    const reminders: ReminderDoc[] = remindersSnap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<ReminderDoc, 'id'>) }),
    )
    const projects = new Map<string, string>()
    projectsSnap.forEach((d) => projects.set(d.id, (d.data().name as string) ?? ''))

    if (reminders.length === 0) {
      logger.info('No due reminders — skipping digest run.')
      return
    }

    // Fetch deal statuses for richer email
    const dealIds = [...new Set(reminders.map((r) => r.dealId).filter(Boolean))]
    const deals = new Map<string, DealDoc>()
    if (dealIds.length > 0) {
      // Batched in groups of 10 (Firestore 'in' query limit)
      for (let i = 0; i < dealIds.length; i += 10) {
        const chunk = dealIds.slice(i, i + 10)
        const snap = await db
          .collection('deals')
          .where('__name__', 'in', chunk.map((id) => db.doc(`deals/${id}`)))
          .get()
        snap.forEach((d) =>
          deals.set(d.id, { id: d.id, status: (d.data().status as string) ?? '' }),
        )
      }
    }

    const byRep = new Map<string, ReminderDoc[]>()
    for (const r of reminders) {
      const arr = byRep.get(r.repId) ?? []
      arr.push(r)
      byRep.set(r.repId, arr)
    }

    let sent = 0
    let skipped = 0
    for (const [repId, rs] of byRep.entries()) {
      const user = users.find((u) => u.id === repId)
      if (!user || user.disabled || !user.email) {
        skipped++
        continue
      }
      const rows: ReminderRow[] = rs
        .sort((a, b) => a.dueAt.toMillis() - b.dueAt.toMillis())
        .map((r) => ({
          merchantName: r.merchantName,
          projectName: projects.get(r.projectId) ?? '',
          type: r.type,
          note: r.note,
          dueAt: r.dueAt.toDate(),
          status: deals.get(r.dealId)?.status,
        }))
      const html = renderEmail(user.name, rows)
      try {
        await resend.emails.send({
          from: fromAddr,
          to: user.email,
          subject: `kreateandco — ${rows.length} reminder${rows.length === 1 ? '' : 's'} today`,
          html,
        })
        sent++
      } catch (err) {
        logger.error(`Failed to send digest to ${user.email}:`, err)
      }
    }
    logger.info(
      `Digest run complete. sent=${sent} skipped=${skipped} reminders=${reminders.length}`,
    )
  },
)
