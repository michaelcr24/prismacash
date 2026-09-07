-- Alta de dispositivo + recarga inicial (sección 5.1 del plan).
-- Igual que charge(): SECURITY DEFINER, invocable solo por service_role
-- desde la Edge Function `issue-device`, nunca directo por PostgREST.

create or replace function issue_device(
  p_event_id uuid,
  p_device_uid text,
  p_device_type device_kind,
  p_attendee_name text default null,
  p_attendee_phone text default null,
  p_attendee_id uuid default null,
  p_initial_amount numeric default 0,
  p_branch_id uuid default null,
  p_attendant_id uuid default null,
  p_client_tx_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendee_id uuid;
  v_device_id uuid;
  v_existing_tx transactions%rowtype;
begin
  if p_initial_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_client_tx_id is not null then
    select * into v_existing_tx from transactions where client_tx_id = p_client_tx_id;
    if found then
      return jsonb_build_object(
        'ok', true, 'device_id', v_existing_tx.device_id,
        'balance', v_existing_tx.balance_after, 'replayed', true
      );
    end if;
  end if;

  if p_attendee_id is not null then
    select id into v_attendee_id from attendees
      where id = p_attendee_id and event_id = p_event_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'attendee_not_found');
    end if;
  else
    insert into attendees (event_id, full_name, phone)
      values (p_event_id, coalesce(p_attendee_name, 'Sin nombre'), p_attendee_phone)
      returning id into v_attendee_id;
  end if;

  begin
    insert into devices (event_id, uid, type, status, assigned_attendee_id, assigned_at)
      values (p_event_id, p_device_uid, p_device_type, 'active', v_attendee_id, now())
      returning id into v_device_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'uid_taken');
  end;

  insert into wallets (device_id, balance) values (v_device_id, 0);

  if p_initial_amount > 0 then
    update wallets set balance = p_initial_amount, version = version + 1, updated_at = now()
      where device_id = v_device_id;

    insert into transactions (
      event_id, branch_id, device_id, type, amount,
      balance_before, balance_after, attendant_id, client_tx_id
    ) values (
      p_event_id, p_branch_id, v_device_id, 'initial_load', p_initial_amount,
      0, p_initial_amount, p_attendant_id, p_client_tx_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'attendee_id', v_attendee_id,
    'balance', p_initial_amount
  );
end;
$$;

revoke all on function issue_device(
  uuid, text, device_kind, text, text, uuid, numeric, uuid, uuid, uuid
) from public;
revoke all on function issue_device(
  uuid, text, device_kind, text, text, uuid, numeric, uuid, uuid, uuid
) from authenticated, anon;
grant execute on function issue_device(
  uuid, text, device_kind, text, text, uuid, numeric, uuid, uuid, uuid
) to service_role;
