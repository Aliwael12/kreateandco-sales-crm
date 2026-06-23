-- ============================================================================
-- kreateandco Sales CRM — Tiered lead (merchants) visibility
--
-- Replaces the previous "everyone signed in sees every lead" rule with a
-- hierarchy keyed on the ROLE OF THE LEAD'S CREATOR:
--
--   • Lead created by an Admin            → visible to Admins only
--   • Lead created by a Head/Sales Head   → visible to Heads + Admins
--   • Lead created by anyone else
--     (Rep, Intern, BD)                   → visible to everyone signed in
--
-- Equivalently, by viewer role:
--   • Admin            → sees all leads
--   • Head/Sales Head  → sees head-tier + rep-tier leads (not admin-tier)
--   • Rep/Intern/BD    → sees rep-tier leads only
--
-- Writes are constrained to match visibility:
--   • INSERT  — any signed-in user, created_by must be self (their new lead
--               lands in their own tier and is visible per the rules above).
--   • UPDATE  — only a lead you are allowed to see.
--   • DELETE  — Admin only (unchanged).
--
-- Everything else (deals, reminders, tasks, activities, users, projects,
-- stages, industries) is intentionally left exactly as in 02_rls.sql. This
-- file only touches the merchants table + adds two helper functions.
--
-- Idempotent: helpers use create-or-replace; the merchants policies are
-- dropped-if-exists before being recreated. Safe to re-run.
-- ============================================================================

-- Role of a lead's creator, looked up from public.users. SECURITY DEFINER so
-- the lookup is not blocked by users' own RLS (same pattern as my_role()).
-- Returns null if the creator row is missing (e.g. deleted user); such a lead
-- is then treated as admin-only by can_see_lead() below (fail closed).
create or replace function public.lead_creator_role(creator uuid)
returns role_t
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = creator;
$$;

-- Can the current user see a lead created by `creator`?
--   creator is Admin      → only admins
--   creator is Head-tier  → heads or admins
--   creator is rep-tier   → everyone signed in
--   creator unknown/null  → admins only (fail closed)
create or replace function public.can_see_lead(creator uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.lead_creator_role(creator)
    when 'Admin'      then public.is_admin()
    when 'Head'       then public.is_admin() or public.is_head()
    when 'Sales Head' then public.is_admin() or public.is_head()
    when 'BD'         then true
    when 'Rep'        then true
    when 'Intern'     then true
    else public.is_admin()   -- unknown / deleted creator → admins only
  end;
$$;

-- ── merchants (leads) — replace the four prior policies ─────────────────────
drop policy if exists merchants_read   on public.merchants;
drop policy if exists merchants_insert on public.merchants;
drop policy if exists merchants_update on public.merchants;
drop policy if exists merchants_delete on public.merchants;

-- read: tiered by creator role (see can_see_lead).
create policy merchants_read on public.merchants
  for select to authenticated
  using (public.can_see_lead(created_by));

-- create: any signed-in user; created_by must be self. The lead's tier is
-- determined by the creator's role, so a new lead is automatically visible to
-- the right audience.
create policy merchants_insert on public.merchants
  for insert to authenticated
  with check (created_by = auth.uid());

-- update: only a lead you are allowed to see. created_by must remain self-
-- consistent (you cannot re-parent a lead to a different creator/tier).
create policy merchants_update on public.merchants
  for update to authenticated
  using (public.can_see_lead(created_by))
  with check (
    public.can_see_lead(created_by)
    and created_by = (select m.created_by from public.merchants m where m.id = public.merchants.id)
  );

-- delete: admin only (unchanged from 02_rls.sql).
create policy merchants_delete on public.merchants
  for delete to authenticated
  using (public.is_admin());
