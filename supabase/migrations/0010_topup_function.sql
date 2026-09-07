-- Recarga de saldo a un dispositivo YA emitido (sección 5 del plan, tipo de
-- transacción `topup`). A diferencia de `issue_device` (alta + carga
-- inicial), este es el camino para sumar saldo a un dispositivo existente
-- desde el quiosco. Misma forma que charge(): SECURITY DEFINER, invocable
-- solo por service_role desde la Edge Function `topup`.

create or replace function topup(
  p_device_uid text,
  p_event_id uuid,
  p_amount numeric,
  p_branch_id uuid default null,
  p_attendant_id uuid default null,
  p_client_tx_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device devices%rowtype;
  v_wallet wallets%rowtype;
  v_existing_tx transactions%rowtype;
  v_new_balance numeric(12, 2);
  v_tx_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_client_tx_id is not null then
    select * into v_existing_tx from transactions where client_tx_id = p_client_tx_id;
    if found then
      return jsonb_build_object(
        'ok', true,
        'new_balance', v_existing_tx.balance_after,
        'tx_id', v_existing_tx.id,
        'replayed', true
      );
    end if;
  end if;

  select * into v_device from devices
    where uid = p_device_uid and event_id = p_event_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_device.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_device.id::text, 0));

  select * into v_wallet from wallets where device_id = v_device.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_new_balance := v_wallet.balance + p_amount;

  update wallets
    set balance = v_new_balance, version = version + 1, updated_at = now()
    where device_id = v_device.id;

  insert into transactions (
    event_id, branch_id, device_id, type, amount,
    balance_before, balance_after, attendant_id, client_tx_id
  ) values (
    p_event_id, p_branch_id, v_device.id, 'topup', p_amount,
    v_wallet.balance, v_new_balance, p_attendant_id, p_client_tx_id
  ) returning id into v_tx_id;

  return jsonb_build_object(
    'ok', true,
    'new_balance', v_new_balance,
    'tx_id', v_tx_id
  );
end;
$$;

revoke all on function topup(text, uuid, numeric, uuid, uuid, uuid) from public;
revoke all on function topup(text, uuid, numeric, uuid, uuid, uuid) from authenticated, anon;
grant execute on function topup(text, uuid, numeric, uuid, uuid, uuid) to service_role;
