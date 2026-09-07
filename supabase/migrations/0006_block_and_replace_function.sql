-- Dispositivo extraviado: bloquea el viejo, crea uno nuevo y migra el saldo
-- en la misma transacción (sección 5.3 del plan). El historial del
-- asistente queda íntegro porque nunca se toca el dispositivo original,
-- solo se marca blocked y se enlaza vía replaced_by.

create or replace function block_and_replace(
  p_old_device_uid text,
  p_event_id uuid,
  p_new_device_uid text,
  p_new_device_type device_kind,
  p_branch_id uuid default null,
  p_attendant_id uuid default null,
  p_client_tx_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old devices%rowtype;
  v_old_wallet wallets%rowtype;
  v_new_device_id uuid;
  v_existing_tx transactions%rowtype;
begin
  if p_client_tx_id is not null then
    select * into v_existing_tx from transactions where client_tx_id = p_client_tx_id;
    if found then
      return jsonb_build_object('ok', true, 'new_device_id', v_existing_tx.device_id, 'replayed', true);
    end if;
  end if;

  select * into v_old from devices
    where uid = p_old_device_uid and event_id = p_event_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_old.status = 'retired' then
    return jsonb_build_object('ok', false, 'error', 'already_retired');
  end if;

  select * into v_old_wallet from wallets where device_id = v_old.id for update;

  insert into devices (event_id, uid, type, status, assigned_attendee_id, assigned_at)
    values (p_event_id, p_new_device_uid, p_new_device_type, 'active', v_old.assigned_attendee_id, now())
    returning id into v_new_device_id;

  insert into wallets (device_id, balance) values (v_new_device_id, v_old_wallet.balance);

  update devices set status = 'blocked', replaced_by = v_new_device_id where id = v_old.id;
  update wallets set balance = 0, version = version + 1, updated_at = now() where device_id = v_old.id;

  -- amount > 0 es un check constraint del ledger; si no había saldo que
  -- migrar, el bloqueo/reemplazo ya quedó registrado vía devices.status +
  -- replaced_by, sin necesidad de una transacción de saldo cero.
  if v_old_wallet.balance > 0 then
    insert into transactions (
      event_id, branch_id, device_id, type, amount, balance_before, balance_after,
      attendant_id, client_tx_id
    ) values (
      p_event_id, p_branch_id, v_old.id, 'migration_out', v_old_wallet.balance,
      v_old_wallet.balance, 0, p_attendant_id, p_client_tx_id
    );

    insert into transactions (
      event_id, branch_id, device_id, type, amount, balance_before, balance_after, attendant_id
    ) values (
      p_event_id, p_branch_id, v_new_device_id, 'migration_in', v_old_wallet.balance,
      0, v_old_wallet.balance, p_attendant_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'new_device_id', v_new_device_id,
    'balance', v_old_wallet.balance
  );
end;
$$;

revoke all on function block_and_replace(
  text, uuid, text, device_kind, uuid, uuid, uuid
) from public;
revoke all on function block_and_replace(
  text, uuid, text, device_kind, uuid, uuid, uuid
) from authenticated, anon;
grant execute on function block_and_replace(
  text, uuid, text, device_kind, uuid, uuid, uuid
) to service_role;
