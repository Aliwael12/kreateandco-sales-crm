-- ============================================================================
-- Schedule the daily-reminder-digest Edge Function with pg_cron + pg_net.
--
-- Replaces the Firebase scheduled function (onSchedule '0 9 * * *',
-- Africa/Cairo). pg_cron runs in UTC, so 09:00 Africa/Cairo (UTC+2, no DST
-- since 2014) = 07:00 UTC. If Egypt re-introduces DST, adjust to 06:00.
--
-- Prereqs (run once, as a superuser / via the dashboard SQL editor):
--   1. Enable extensions: Dashboard → Database → Extensions → pg_cron, pg_net.
--   2. Deploy the function:  supabase functions deploy daily-reminder-digest
--   3. Set the function's secrets:
--        supabase secrets set RESEND_API_KEY=... DIGEST_FROM_EMAIL="kreateandco <...>"
--
-- BEFORE RUNNING: replace <PROJECT_REF> and <SERVICE_ROLE_KEY> below. The
-- service-role key authorizes pg_net to invoke the function; keep this SQL out
-- of version control once filled in (or use Vault — see the commented variant).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior schedule so this is re-runnable.
select cron.unschedule('daily-reminder-digest')
where exists (select 1 from cron.job where jobname = 'daily-reminder-digest');

select cron.schedule(
  'daily-reminder-digest',
  '0 7 * * *',            -- 07:00 UTC = 09:00 Africa/Cairo
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminder-digest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify:  select * from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 10;
