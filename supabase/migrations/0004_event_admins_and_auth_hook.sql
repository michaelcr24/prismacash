-- Cierra un hueco del modelo original (sección 4/7 del plan): las políticas
-- RLS asumen claims `event_role` / `event_id` en el JWT, pero nada los
-- generaba todavía. Sin esto, auth_role()/auth_event_id() siempre son NULL
-- y ningún usuario autenticado (aparte de leer su propio profile) puede ver
-- datos, aunque sea event_admin u operator legítimo.
--
-- Simplificación MVP: se asume una sola asignación de evento por cuenta de
-- event_admin (si más adelante una misma persona administra varios eventos
-- a la vez, necesitará una cuenta por evento o este hook debe extenderse
-- para elegir el evento activo de otra forma, ej. un claim adicional al
-- iniciar sesión).

create table event_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (user_id, event_id)
);

alter table event_admins enable row level security;

create policy super_admin_all_event_admins on event_admins
  for all using (is_super_admin()) with check (is_super_admin());
create policy self_event_admins on event_admins
  for select using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════
-- Auth Hook: "Customize Access Token (JWT) Claims"
-- Debe activarse manualmente en Dashboard → Authentication → Hooks
-- (Postgres Hook → esta función). No hay forma de activarlo solo con SQL.
-- ══════════════════════════════════════════════════════════════════
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims jsonb;
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_role user_role;
  v_org_id uuid;
  v_event_id uuid;
begin
  select role, org_id into v_role, v_org_id from profiles where id = v_user_id;

  if v_role = 'event_admin' then
    select event_id into v_event_id from event_admins where user_id = v_user_id limit 1;
  elsif v_role = 'operator' then
    select b.event_id into v_event_id
      from branch_members bm join branches b on b.id = bm.branch_id
      where bm.user_id = v_user_id limit 1;
  end if;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  if v_role is not null then
    claims := jsonb_set(claims, '{event_role}', to_jsonb(v_role::text));
  end if;
  if v_org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org_id::text));
  end if;
  if v_event_id is not null then
    claims := jsonb_set(claims, '{event_id}', to_jsonb(v_event_id::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Contrato exigido por Supabase para Auth Hooks en Postgres: solo
-- supabase_auth_admin puede ejecutar la función, nadie más.
grant usage on schema public to supabase_auth_admin;
revoke execute on function custom_access_token_hook from public, authenticated, anon;
grant execute on function custom_access_token_hook to supabase_auth_admin;

grant select on profiles, event_admins, branch_members, branches to supabase_auth_admin;
