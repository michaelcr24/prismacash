-- Corrige el bug real detrás del 500 en login: a diferencia de charge(),
-- issue_device() y block_and_replace(), custom_access_token_hook() no tenía
-- `set search_path = public`. supabase_auth_admin abre una conexión nueva
-- para llamar al hook y su search_path por defecto no incluye `public`,
-- así que no encontraba el tipo `user_role` sin calificar.
--
-- Confirmado en los logs de Postgres: "42704 type user_role does not
-- exist" en cada intento real de login después de activar el hook. Una
-- reproducción manual con `set role supabase_auth_admin` en el SQL Editor
-- no lo mostraba porque esa sesión ya tenía `public` en su search_path
-- (heredado de la sesión del propio editor), a diferencia de una conexión
-- nueva real.

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

grant usage on schema public to supabase_auth_admin;
revoke execute on function custom_access_token_hook from public, authenticated, anon;
grant execute on function custom_access_token_hook to supabase_auth_admin;
grant select on profiles, event_admins, branch_members, branches to supabase_auth_admin;
