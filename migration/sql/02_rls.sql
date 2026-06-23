-- ============================================================================
-- kreateandco Sales CRM — Row Level Security
-- Faithful translation of firestore.rules to Postgres RLS.
--
-- Role model (unchanged from Firestore):
--   Admin                — read/write everything
--   Head / 'Sales Head'  — read everything; write own deals/reminders;
--                          reassign deals; manage tasks; edit users.projectIds
--   BD                   — read everything; write only own deals/reminders
--   Rep, Intern          — read/write only own deals/reminders/tasks
--   Anyone signed in     — read users/projects/stages/merchants/industries
--   activities           — any signed-in user may INSERT a row tagged with
--                          their own uid; nobody UPDATE/DELETE; read = canSeeAll
--
-- The privileged server paths (createUser, the digest job) use the
-- service-role key, which BYPASSES RLS entirely — same as the Firebase Admin
-- SDK bypassed firestore.rules.
-- ============================================================================

-- ── helper predicates (SECURITY DEFINER so they can read public.users
--    without being blocked by users' own RLS — mirrors get(/users/$uid)) ─────

create or replace function public.my_role()
returns role_t
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'Admin', false);
$$;

create or replace function public.is_head()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('Head', 'Sales Head'), false);
$$;

create or replace function public.is_head_or_bd()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('Head', 'Sales Head', 'BD'), false);
$$;

-- canSeeAll = Admin | Head | BD  (matches src/context/auth.ts)
create or replace function public.can_see_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_head_or_bd();
$$;

-- ── enable RLS on every table ───────────────────────────────────────────────
alter table public.users      enable row level security;
alter table public.projects   enable row level security;
alter table public.stages     enable row level security;
alter table public.merchants  enable row level security;
alter table public.deals      enable row level security;
alter table public.reminders  enable row level security;
alter table public.tasks      enable row level security;
alter table public.industries enable row level security;
alter table public.activities enable row level security;

-- Drop any prior policies so this file is re-runnable.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ── users ───────────────────────────────────────────────────────────────────
-- read: anyone signed in. create/delete: admin. update: admin, OR a Head may
-- change only project_ids (+ updated_at).
create policy users_read on public.users
  for select to authenticated using (true);

create policy users_insert on public.users
  for insert to authenticated with check (public.is_admin());

create policy users_delete on public.users
  for delete to authenticated using (public.is_admin());

create policy users_update on public.users
  for update to authenticated
  using (public.is_admin() or public.is_head())
  with check (
    public.is_admin()
    or (
      public.is_head()
      -- Head may only ever touch project_ids; all other columns must equal the
      -- existing row. Enforced by comparing to the pre-image via a trigger-free
      -- column guard: re-check the immutable columns haven't changed.
      and (select u.role        from public.users u where u.id = public.users.id) = role
      and (select u.email       from public.users u where u.id = public.users.id) = email
      and (select u.name        from public.users u where u.id = public.users.id) = name
      and (select u.color       from public.users u where u.id = public.users.id) = color
      and (select u.disabled    from public.users u where u.id = public.users.id) = disabled
    )
  );

-- ── projects ────────────────────────────────────────────────────────────────
create policy projects_read on public.projects
  for select to authenticated using (true);
create policy projects_write on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── stages ──────────────────────────────────────────────────────────────────
create policy stages_read on public.stages
  for select to authenticated using (true);
create policy stages_write on public.stages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── merchants ───────────────────────────────────────────────────────────────
-- read: any signed in. create: any signed in, created_by must be self.
-- update: any signed in. delete: admin.
create policy merchants_read on public.merchants
  for select to authenticated using (true);
create policy merchants_insert on public.merchants
  for insert to authenticated with check (created_by = auth.uid());
create policy merchants_update on public.merchants
  for update to authenticated using (true) with check (true);
create policy merchants_delete on public.merchants
  for delete to authenticated using (public.is_admin());

-- ── industries ──────────────────────────────────────────────────────────────
create policy industries_read on public.industries
  for select to authenticated using (true);
create policy industries_write on public.industries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── deals ───────────────────────────────────────────────────────────────────
-- read: canSeeAll OR owner. create: admin OR owner(self as rep), created_by self.
-- update: admin OR head OR owner. delete: admin OR owner.
create policy deals_read on public.deals
  for select to authenticated
  using (public.can_see_all() or rep_id = auth.uid());

create policy deals_insert on public.deals
  for insert to authenticated
  with check (
    (public.is_admin() or rep_id = auth.uid())
    and created_by = auth.uid()
  );

create policy deals_update on public.deals
  for update to authenticated
  using (public.is_admin() or public.is_head() or rep_id = auth.uid())
  with check (public.is_admin() or public.is_head() or rep_id = auth.uid());

create policy deals_delete on public.deals
  for delete to authenticated
  using (public.is_admin() or rep_id = auth.uid());

-- ── reminders ───────────────────────────────────────────────────────────────
-- read: canSeeAll OR owner.
-- create: admin OR canSeeAll OR owner(self) OR type='assignment'.
-- update: admin OR (owner AND rep_id unchanged). delete: admin OR owner.
create policy reminders_read on public.reminders
  for select to authenticated
  using (public.can_see_all() or rep_id = auth.uid());

create policy reminders_insert on public.reminders
  for insert to authenticated
  with check (
    public.is_admin()
    or public.can_see_all()
    or rep_id = auth.uid()
    or type = 'assignment'
  );

create policy reminders_update on public.reminders
  for update to authenticated
  using (
    public.is_admin()
    or (rep_id = auth.uid())
  )
  with check (
    public.is_admin()
    or (
      rep_id = auth.uid()
      -- rep_id must not change (mirrors request.resource.data.repId == resource.data.repId)
      and rep_id = (select r.rep_id from public.reminders r where r.id = public.reminders.id)
    )
  );

create policy reminders_delete on public.reminders
  for delete to authenticated
  using (public.is_admin() or rep_id = auth.uid());

-- ── tasks ───────────────────────────────────────────────────────────────────
-- read: canSeeAll OR owner(assignee).
-- create: (admin OR head) AND created_by self.
-- update: admin OR (assignee AND assignee unchanged AND only status fields).
-- delete: admin OR head.
create policy tasks_read on public.tasks
  for select to authenticated
  using (public.can_see_all() or assignee_id = auth.uid());

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ((public.is_admin() or public.is_head()) and created_by = auth.uid());

-- The "only status columns may change" constraint from firestore.rules is
-- enforced for the assignee path by comparing every non-status column to its
-- stored value. Admin path bypasses the column guard.
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_admin() or assignee_id = auth.uid())
  with check (
    public.is_admin()
    or (
      assignee_id = auth.uid()
      and assignee_id     = (select t.assignee_id     from public.tasks t where t.id = public.tasks.id)
      and title           = (select t.title           from public.tasks t where t.id = public.tasks.id)
      and merchant_id     = (select t.merchant_id     from public.tasks t where t.id = public.tasks.id)
      and merchant_name   = (select t.merchant_name   from public.tasks t where t.id = public.tasks.id)
      and project_id      = (select t.project_id      from public.tasks t where t.id = public.tasks.id)
      and created_by      = (select t.created_by      from public.tasks t where t.id = public.tasks.id)
      and created_by_name = (select t.created_by_name from public.tasks t where t.id = public.tasks.id)
      and note            = (select t.note            from public.tasks t where t.id = public.tasks.id)
      and due_at is not distinct from (select t.due_at from public.tasks t where t.id = public.tasks.id)
    )
  );

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_admin() or public.is_head());

-- ── activities ──────────────────────────────────────────────────────────────
-- read: canSeeAll. insert: any signed-in user, who = self. no update/delete.
create policy activities_read on public.activities
  for select to authenticated using (public.can_see_all());

create policy activities_insert on public.activities
  for insert to authenticated with check (who = auth.uid());

-- (no update/delete policies => denied for non-service-role, matching
--  firestore.rules `allow update, delete: if false`.)
