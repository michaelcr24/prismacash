-- Causa raíz real del bug de login (confirmada con los logs de
-- HOOK DEBUG añadidos en 0008): `profiles`, `event_admins` y
-- `branch_members`/`branches` tienen RLS activado, y ninguna política
-- cubre a `supabase_auth_admin`. El GRANT SELECT de 0004 no alcanza:
-- privilegio de tabla y RLS son capas independientes, y sin una política
-- que aplique, RLS filtra todas las filas — por eso el hook siempre veía
-- v_role/v_org_id en NULL en un login real, aunque la fila sí existe.
--
-- `supabase_auth_admin` es un rol interno de Supabase que solo el propio
-- servicio de Auth usa (nunca queda expuesto a un cliente), así que darle
-- lectura incondicional sobre estas tablas de lookup es seguro y acotado.

create policy auth_admin_read_profiles on profiles
  for select to supabase_auth_admin using (true);

create policy auth_admin_read_event_admins on event_admins
  for select to supabase_auth_admin using (true);

create policy auth_admin_read_branch_members on branch_members
  for select to supabase_auth_admin using (true);

create policy auth_admin_read_branches on branches
  for select to supabase_auth_admin using (true);

-- Limpia la instrumentación temporal de depuración de 0008 — misma lógica,
-- sin los `raise log`.
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
