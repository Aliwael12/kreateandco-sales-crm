-- ── tasks: who a Head may assign to ─────────────────────────────────────────
-- Rule (matches the CreateTaskModal assignee list):
--   • Admin → may assign a task to anyone (Heads and reps).
--   • Head  → may assign tasks ONLY to reps — never to another Head or an Admin.
--
-- The original tasks_insert policy let any Admin/Head insert with no constraint
-- on the assignee, so a Head could assign to another Head. This tightens it by
-- checking the ASSIGNEE's role. Idempotent / re-runnable.

-- Look up an arbitrary user's role (the existing is_admin()/is_head() helpers
-- only test the *current* user). security definer so it can read public.users
-- regardless of the caller's RLS.
create or replace function public.role_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = uid;
$$;

drop policy if exists tasks_insert on public.tasks;

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      -- Admins can assign to anyone.
      public.is_admin()
      -- Heads can assign only to a rep (assignee is neither Head nor Admin).
      or (
        public.is_head()
        and coalesce(public.role_of(assignee_id), '') not in
          ('Admin', 'Head', 'Sales Head')
      )
    )
  );
