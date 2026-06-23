// Supabase Edge Function — daily-reminder-digest
//
// Port of the Firebase `dailyReminderDigest` Cloud Function. For each user with
// active reminders due today or overdue (Africa/Cairo), sends one email via
// Resend listing them. Invoked on a schedule by pg_cron (see
// supabase/sql/03_cron.sql), which calls this function's HTTPS endpoint.
//
// Deploy:
//   supabase functions deploy daily-reminder-digest --no-verify-jwt
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY        — Resend API key
//   DIGEST_FROM_EMAIL     — e.g. "kreateandco <crm@your-verified-domain.com>"
//   SUPABASE_URL          — auto-injected in the Functions runtime
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected in the Functions runtime
//
// This runs server-side with the service-role key, so it bypasses RLS (it needs
// to read every user's reminders), exactly like the Admin SDK did before.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM = Deno.env.get('DIGEST_FROM_EMAIL')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7;">kreateandco Sales Platform</div>
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

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // End-of-today in Cairo, as a UTC instant.
  const now = new Date()
  const cairoNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }))
  const endOfToday = new Date(cairoNow)
  endOfToday.setHours(23, 59, 59, 999)
  const cutoffMs = endOfToday.getTime() + (now.getTime() - cairoNow.getTime())
  const cutoff = new Date(cutoffMs)

  const [{ data: users }, { data: reminders }, { data: projects }] =
    await Promise.all([
      db.from('users').select('id, name, email, disabled'),
      db
        .from('reminders')
        .select('id, deal_id, merchant_name, project_id, rep_id, type, note, due_at')
        .eq('dismissed', false)
        .lte('due_at', cutoff.toISOString()),
      db.from('projects').select('id, name'),
    ])

  if (!reminders || reminders.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no due reminders' }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  const projectName = new Map<string, string>(
    (projects ?? []).map((p) => [p.id, p.name ?? '']),
  )

  // Deal statuses for richer email.
  const dealIds = [...new Set(reminders.map((r) => r.deal_id).filter(Boolean))]
  const dealStatus = new Map<string, string>()
  if (dealIds.length > 0) {
    const { data: deals } = await db
      .from('deals')
      .select('id, status')
      .in('id', dealIds)
    for (const d of deals ?? []) dealStatus.set(d.id, d.status ?? '')
  }

  const byRep = new Map<string, typeof reminders>()
  for (const r of reminders) {
    const arr = byRep.get(r.rep_id) ?? []
    arr.push(r)
    byRep.set(r.rep_id, arr)
  }

  let sent = 0
  let skipped = 0
  for (const [repId, rs] of byRep.entries()) {
    const user = (users ?? []).find((u) => u.id === repId)
    if (!user || user.disabled || !user.email) {
      skipped++
      continue
    }
    const rows: ReminderRow[] = rs
      .slice()
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
      .map((r) => ({
        merchantName: r.merchant_name ?? '',
        projectName: projectName.get(r.project_id) ?? '',
        type: r.type ?? '',
        note: r.note ?? '',
        dueAt: new Date(r.due_at),
        status: dealStatus.get(r.deal_id),
      }))
    const html = renderEmail(user.name ?? '', rows)
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM,
          to: user.email,
          subject: `kreateandco — ${rows.length} reminder${rows.length === 1 ? '' : 's'} today`,
          html,
        }),
      })
      if (res.ok) sent++
      else skipped++
    } catch {
      skipped++
    }
  }

  return new Response(JSON.stringify({ sent, skipped, reminders: reminders.length }), {
    headers: { 'content-type': 'application/json' },
  })
})
