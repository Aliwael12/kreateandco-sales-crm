-- ── projects: completion state ──────────────────────────────────────────────
-- Splits the My Projects page into "In Progress" and "Completed" tabs. A project
-- is in progress by default; admins mark it complete (e.g. Brito) to move it to
-- the Completed tab without deleting it or its deals. `completed_at` records when
-- it was marked, and is cleared when a project is reopened. Idempotent so it is
-- safe to re-run.

alter table public.projects
  add column if not exists completed    boolean     not null default false,
  add column if not exists completed_at timestamptz;

-- Cheap filter for the two tabs.
create index if not exists projects_completed_idx on public.projects (completed);
