-- Lógica de cobro atómica (sección 5.2 del plan).
-- Corre como SECURITY DEFINER porque muta wallets/transactions, que los
-- clientes autenticados no pueden escribir directamente (ver 0001_init.sql).
-- Solo se invoca desde la Edge Function `charge` con el cliente service_role.

create or replace function charge(
  p_device_uid text,
  p_event_id uuid,
  p_amount numeric,
  p_branch_id uuid default null,
  p_terminal_id uuid default null,
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

  -- idempotencia: un reintento de red con el mismo client_tx_id no debe
  -- volver a descontar saldo (sección 10 del plan).
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
    for update; -- bloquea la fila del dispositivo por el resto de la transacción

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_device.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;

  -- lock adicional por device_id: serializa cobros concurrentes al mismo
  -- dispositivo aunque lleguen desde terminales/conexiones distintas.
  perform pg_advisory_xact_lock(hashtextextended(v_device.id::text, 0));

  select * into v_wallet from wallets where device_id = v_device.id for update;
  if not found or v_wallet.balance < p_amount then
    return jsonb_build_object('ok', false, 'error', 'insufficient_funds');
  end if;

  v_new_balance := v_wallet.balance - p_amount;

  update wallets
    set balance = v_new_balance, version = version + 1, updated_at = now()
    where device_id = v_device.id;

  insert into transactions (
    event_id, branch_id, terminal_id, device_id, type, amount,
    balance_before, balance_after, attendant_id, client_tx_id
  ) values (
    p_event_id, p_branch_id, p_terminal_id, v_device.id, 'payment', p_amount,
    v_wallet.balance, v_new_balance, p_attendant_id, p_client_tx_id
  ) returning id into v_tx_id;

  return jsonb_build_object(
    'ok', true,
    'new_balance', v_new_balance,
    'tx_id', v_tx_id,
    'device_label', coalesce(v_device.uid, '')
  );
end;
$$;

-- Los clientes nunca llaman esta función directamente vía PostgREST;
-- solo la Edge Function `charge` con el service role key.
-- OJO: Postgres otorga EXECUTE a PUBLIC por defecto al crear una función,
-- y los roles anon/authenticated heredan ese grant de PUBLIC aunque se les
-- revoque el privilegio a ellos directamente — hay que revocar de PUBLIC.
revoke all on function charge(text, uuid, numeric, uuid, uuid, uuid, uuid) from public;
revoke all on function charge(text, uuid, numeric, uuid, uuid, uuid, uuid) from authenticated, anon;
grant execute on function charge(text, uuid, numeric, uuid, uuid, uuid, uuid) to service_role;
