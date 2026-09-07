-- TEMPORAL — solo para diagnosticar por qué el hook no añade claims en un
-- login real aunque la invocación manual sí funciona. Agrega `raise log`
-- para ver en Postgres Logs exactamente qué event manda GoTrue y qué
-- calcula la función. Se revierte con 0009 en cuanto encontremos la causa.

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
  raise log 'HOOK DEBUG event=%', event;
  raise log 'HOOK DEBUG v_user_id=%', v_user_id;

  select role, org_id into v_role, v_org_id from profiles where id = v_user_id;

  raise log 'HOOK DEBUG v_role=% v_org_id=%', v_role, v_org_id;

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

  raise log 'HOOK DEBUG final claims=%', claims;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
