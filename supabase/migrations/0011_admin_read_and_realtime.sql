-- ══════════════════════════════════════════════════════════════
-- 0011 — Panel admin: lectura de staff para event_admin
-- (aplicable también por el SQL Editor del dashboard Supabase)
-- ══════════════════════════════════════════════════════════════

create policy event_scoped_read_profiles on profiles
  for select using (
    id = auth.uid()
    or id in (
      select user_id from event_admins where event_id = auth_event_id()
    )
    or id in (
      select bm.user_id
        from branch_members bm
        join branches b on b.id = bm.branch_id
       where b.event_id = auth_event_id()
    )
  );

create policy event_scoped_read_branch_members on branch_members
  for select using (
    branch_id in (select id from branches where event_id = auth_event_id())
  );

create policy event_scoped_read_event_admins on event_admins
  for select using (event_id = auth_event_id());

create policy super_admin_read_all_profiles on profiles
  for select using (is_super_admin());

-- ══════════════════════════════════════════════════════════════
-- Realtime del dashboard: publica INSERTs de transactions por evento.
-- Los suscriptores ya están filtrados por RLS; la publicación añade el
-- cambio de eventos de Postgres Changes.
-- ══════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end
$$;

alter table public.transactions replica identity full;