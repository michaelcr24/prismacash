# App Móvil de Asistente (PrismaCash Mobile) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la app móvil nativa (Expo) para asistentes: login email+password, emparejamiento por QR, saldo, historial, recarga online con Stripe Checkout, solicitud de reembolso y notificaciones push, más los cambios de backend (migración + Edge Functions) y de PWA (quiosco con QR de emparejamiento, refunds aprobables) que la soportan.

**Architecture:** `mobile/` (Expo Router, supabase-js, react-query, AsyncStorage) dentro del monorepo PrismaCash. Backend: una migración `0014` (rol `attendee`, `attendees.user_id`, `devices.pairing_code`, tabla `payment_requests`, RLS para asistente, RPCs `save_push_token`/`approve_refund`, `issue_device` con pairing) + 4 Edge Functions nuevas (`pair-device`, `create-topup`, `stripe-webhook`, `process-refund`). PWA: quiosco imprime QR de emparejamiento y Refunds aprueba/rechaza.

**Tech Stack:** Expo SDK 53+ (expo-router, expo-camera, expo-web-browser, expo-notifications, expo-screen-brightness, react-native-qrcode-svg), @supabase/supabase-js, @tanstack/react-query, @react-native-async-storage/async-storage, Stripe (npm:stripe en Edge Functions), Deno Edge Functions.

## Global Constraints

- **Entorno:** Windows, PowerShell 5.1. NO hay `supabase` CLI ni `deno` en esta máquina. Migraciones se aplican por **SQL Editor** del dashboard; Edge Functions se despliegan por **Dashboard** (zip de la carpeta `supabase/functions/`). (ver memoria `prismacash.md`).
- **Repos:** trabajo en worktree `C:\Users\mmaltes\Documents\Proyecto-user-management`. La carpeta de docs (`docs/superpowers/`) vive en el repo principal `C:\Users\mmaltes\Documents\Proyecto` (rama `main`). El código de la feature (supabase/ + src/ + mobile/) vive en `Proyecto-user-management`.
- **Rama:** crear `feature/mobile-app` partiendo del HEAD actual de `feature/user-management` (`7a36ce2`).
- **Embeds PostgREST:** usar SIEMPRE el nombre de la tabla en plural: `profiles` (no `profile`/`user`), `devices`, `wallets`, `attendees`, `transactions`, `events`, `refund_requests` (NO `refunds`), `branch_members`, `event_admins`. Los nombres en singular dan PGRST200 (400) en vivo.
- **No usar react-hook-form/zod** en PWA; en mobile tampoco — inputs controlados con `useState`.
- **Edge Functions:** Deno, `jsr:@supabase/supabase-js@2`, `_shared/` (cors.ts, operator.ts). Excluidas de eslint (`eslint.config.js:12`) y de tsc → verificación por **review + smoke test**, no por typecheck.
- **PWA viene de la rama feature**: `src/pages/admin/Refunds.tsx` y `src/pages/Kiosk.tsx` actuales ya tienen los fixes de embeds (plural). NO regresionarlos.
- **Moneda:** `numeric(12,2)`. Formato UI: `Intl.NumberFormat('es-CR', { style:'currency', currency: <event.currency>, maximumFractionDigits: 0 })`.
- **Confirmación de la PWA:** `npm run build` y `npm run lint` deben quedar limpios tras cada tarea que toque la raíz. Anexar `mobile` a `globalIgnores` de eslint raíz en la Task 1.
- **Verificación mobile:** `npx tsc --noEmit` + `npx expo export` + `npx jest` (si se añaden tests) dentro de `mobile/`.

---

### Task 1: Setup de la rama y aislamiento de `mobile/` en lint

**Files:**
- Create: (branch `feature/mobile-app`)
- Modify: `eslint.config.js:12` (añadir `mobile` a globalIgnores)

**Contexto:** Preparamos la rama feature y evitamos que el eslint raíz (Node/browser) intente lintear la app Expo (que tiene reglas de resolución distintas para RN).

- [ ] **Step 1: Crear rama `feature/mobile-app`**

```powershell
git switch -c feature/mobile-app
```

- [ ] **Step 2: Añadir `mobile` a los globalIgnores del eslint raíz**

En `eslint.config.js`, línea 12:

```js
globalIgnores(['dist', 'supabase/functions', 'mobile']),
```

- [ ] **Step 3: Verificar que la PWA sigue limpia**

```powershell
npm run build
npm run lint
```

Expected: ambos pasan (build incluye `tsc -b`; lint sin warnings nuevos).

- [ ] **Step 4: Commit**

```powershell
git add eslint.config.js
git commit -m "chore: isolar mobile/ del lint raiz"
```

---

### Task 2: Migración `0014_attendee_flow.sql`

**Files:**
- Create: `supabase/migrations/0014_attendee_flow.sql`

**Interfaces:**
- Produces: tabla `payment_requests` (col `stripe_checkout_id` unique), RPCs `save_push_token(text)` y `approve_refund(uuid,uuid)`, función `issue_device(...)` actualizada (devuelve `{ ok, device_id, attendee_id?, balance, pairing_code }`), políticas RLS para rol `attendee`, columna `profiles.push_token`, columnas `devices.pairing_code/pairing_code_expires_at/paired_at`, columna `attendees.user_id`.

**Design:** Una sola migración que (1) agrega el rol `attendee` al enum, (2) vincula `attendees` a una cuenta de auth, (3) agrega pairing a `devices`, (4) crea `payment_requests`, (5) RLS propietario para asistente, (6) modifica `issue_device` para generar el pairing_code. Es la única migración del plan — aplicar por SQL Editor (usuario).

- [ ] **Step 1: Escribir la migración**

Contenido completo de `supabase/migrations/0014_attendee_flow.sql`:

```sql
-- 0014_attendee_flow.sql
-- App móvil de asistente: rol attendee, emparejamiento por QR, recargas online.

-- 1) Rol attendee
alter type user_role add value 'attendee';

-- 2) attendees → cuenta de auth (null hasta que el asistente empareja)
alter table attendees add column user_id uuid references auth.users(id) on delete set null;
create index attendees_user_id_idx on attendees(user_id) where user_id is not null;

-- 3) devices → código de emparejamiento de un solo uso (QR impreso en el quiosco)
alter table devices add column pairing_code uuid unique;
alter table devices add column pairing_code_expires_at timestamptz;
alter table devices add column paired_at timestamptz;

-- 4) Recargas online (Stripe)
create table payment_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  device_uid text not null,
  event_id uuid not null references events(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','processing','succeeded','failed')),
  stripe_checkout_id text unique,
  tx_id uuid references transactions(id),
  error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
alter table payment_requests enable row level security;

-- Perfil del asistente: crear su propio perfil al registrarse (rol attendee)
create policy self_insert_profile on profiles
  for insert with check (id = auth.uid() and role = 'attendee' and org_id is null);

-- push_token para notificaciones (columna). NO se abre UPDATE genérico en
-- profiles (escalada de rol): el write del push token pasa solo por la RPC
-- save_push_token (security definer).
alter table profiles add column push_token text;

-- RPC: guardar push token (evita RLS por columna)
create or replace function save_push_token(p_token text) returns void
language sql
security definer
set search_path = public
as $$
  update profiles set push_token = p_token where id = auth.uid();
$$;
revoke all on function save_push_token(text) from public, authenticated, anon;
grant execute on function save_push_token(text) to authenticated;

-- RLS asistente — lee SOLO lo que le pertenece (devices → attendees.user_id)
create policy own_attendee_events on events
  for select using (
    id in (select d.event_id from devices d
             join attendees a on a.id = d.assigned_attendee_id
            where a.user_id = auth.uid())
  );

create policy own_attendees on attendees
  for select using (user_id = auth.uid());

create policy own_devices on devices
  for select using (
    assigned_attendee_id in (select id from attendees where user_id = auth.uid())
  );

create policy own_wallets on wallets
  for select using (
    device_id in (select id from devices where assigned_attendee_id in
      (select id from attendees where user_id = auth.uid()))
  );

create policy own_transactions on transactions
  for select using (
    device_id in (select id from devices where assigned_attendee_id in
      (select id from attendees where user_id = auth.uid()))
  );

create policy owner_read_refunds on refund_requests
  for select using (
    device_id in (select id from devices where assigned_attendee_id in
      (select id from attendees where user_id = auth.uid()))
  );
create policy owner_create_refunds on refund_requests
  for insert with check (
    device_id in (select id from devices where assigned_attendee_id in
      (select id from attendees where user_id = auth.uid()))
  );

-- El asistente solo ve sus propias recargas pendientes/resultado
create policy owner_read_payment_requests on payment_requests
  for select using (profile_id = auth.uid());

-- RPC: aprobar reembolso (SIEMPRE dentro de la transacción, con lock)
create or replace function approve_refund(p_refund_id uuid, p_processed_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund refund_requests%rowtype;
  v_device devices%rowtype;
  v_wallet wallets%rowtype;
  v_new_balance numeric(12,2);
  v_tx_id uuid;
begin
  select * into v_refund from refund_requests where id = p_refund_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_refund.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already_processed');
  end if;

  select * into v_device from devices where id = v_refund.device_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_device.id::text, 0));

  select * into v_wallet from wallets where device_id = v_device.id for update;
  if not found or v_wallet.balance < v_refund.amount then
    return jsonb_build_object('ok', false, 'error', 'insufficient_funds');
  end if;

  v_new_balance := v_wallet.balance - v_refund.amount;

  update wallets
    set balance = v_new_balance, version = version + 1, updated_at = now()
    where device_id = v_device.id;

  insert into transactions (
    event_id, device_id, type, amount, balance_before, balance_after, attendant_id
  ) values (
    v_device.event_id, v_device.id, 'refund', v_refund.amount,
    v_wallet.balance, v_new_balance, p_processed_by
  ) returning id into v_tx_id;

  update refund_requests
    set status = 'approved', processed_by = p_processed_by, processed_at = now()
    where id = p_refund_id;

  return jsonb_build_object(
    'ok', true,
    'amount', v_refund.amount,
    'new_balance', v_new_balance,
    'tx_id', v_tx_id
  );
end;
$$;
revoke all on function approve_refund(uuid, uuid) from public, authenticated, anon;
grant execute on function approve_refund(uuid, uuid) to service_role;

-- ── issue_device() actualizada: genera pairing_code (QR de emparejamiento) ──
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
  v_pairing_code uuid;
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

  v_pairing_code := gen_random_uuid();

  if p_attendee_id is not null then
    select id into v_attendee_id from attendees
      where id = p_attendee_id and event_id = p_event_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'attendee_not_found');
    end if;
  end if;

  begin
    insert into devices (
      event_id, uid, type, status, assigned_attendee_id, assigned_at,
      pairing_code, pairing_code_expires_at
    ) values (
      p_event_id, p_device_uid, p_device_type,
      case when p_attendee_id is not null then 'active' else 'unassigned' end,
      v_attendee_id, now(), v_pairing_code, now() + interval '48 hours'
    ) returning id into v_device_id;
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
    'balance', p_initial_amount,
    'pairing_code', v_pairing_code
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
```

- [ ] **Step 2: Aplicar la migración (usuario)**
  - Abrir Dashboard → SQL Editor → pegar el SQL completo (incluida la línea `alter table profiles add column push_token text;`) → Run.
  - Confirmar 0 errores y que todas las políticas se crearon.

- [ ] **Step 3: Smoke test SQL mínimo**
  - En SQL Editor: `select typname, enumlabel from pg_enum join pg_type on pg_type.oid = pg_enum.enumtypid where typname = 'user_role';` → debe listar `attendee`.
  - `\d payment_requests` o `select count(*) from payment_requests;` → tabla existe (0 filas).
  - `select proname from pg_proc where proname in ('save_push_token','approve_refund','issue_device');` → las 3 existen.

---

### Task 3: Edge Function `pair-device`

**Files:**
- Create: `supabase/functions/pair-device/index.ts`

**Interfaces:**
- Consumes: `authenticateOperator` de `_shared/operator.ts`, `json`/`corsHeaders` de `_shared/cors.ts`, columnas `devices.pairing_code`/`status`/`assigned_attendee_id`, tabla `attendees(user_id)` (migración 0014), `profiles(full_name, phone)`.
- Produces: `POST /functions/v1/pair-device` con body `{ code: string }` y response `200 { ok:true, device_id, device_uid, device_type, event: { id, name, currency } }` (o `400 invalid_body`, `404 not_found`, `410 expired`, `409 already_paired`, `403 unauthorized`).

**Design:** Autentica al usuario (JWT), busca el device por `pairing_code` (único), valida expiración y que esté `unassigned`, crea/lee el `attendee` del usuario en ese evento (uno por `user_id+event_id`) y activa el dispositivo marcando el pairing como usado.

- [ ] **Step 1: Escribir la función**

`supabase/functions/pair-device/index.ts`:

```ts
// Edge Function `pair-device` — alta self-service del asistente.
// Recibe el pairing_code escaneado del QR impreso en el quiosco y vincula
// el dispositivo a la cuenta de auth del asistente (rol attendee).
import { authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface PairRequest {
  code: string
}

interface PairSuccess {
  ok: true
  device_id: string
  device_uid: string
  device_type: 'nfc' | 'qr' | 'hybrid'
  event: { id: string; name: string; currency: string }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: PairRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const pairingCode = (body.code ?? '').trim().split('?code=').pop() ?? ''
  if (!pairingCode) return json({ ok: false, error: 'invalid_body' }, 400)

  const { data: device, error: deviceError } = await adminClient
    .from('devices')
    .select('id, uid, type, status, event_id, pairing_code, pairing_code_expires_at, assigned_attendee_id')
    .eq('pairing_code', pairingCode)
    .maybeSingle()

  if (deviceError || !device) return json({ ok: false, error: 'not_found' }, 404)

  if (device.status !== 'unassigned' || device.assigned_attendee_id) {
    return json({ ok: false, error: 'already_paired' }, 409)
  }

  const expiresAt = device.pairing_code_expires_at ? new Date(device.pairing_code_expires_at).getTime() : 0
  if (expiresAt < Date.now()) {
    return json({ ok: false, error: 'expired' }, 410)
  }

  const { data: event } = await adminClient.from('events').select('id, name, currency').eq('id', device.event_id).maybeSingle()
  if (!event) return json({ ok: false, error: 'not_found' }, 404)

  let attendeeId: string | null = null
  const { data: existing } = await adminClient
    .from('attendees')
    .select('id')
    .eq('user_id', userId)
    .eq('event_id', device.event_id)
    .maybeSingle()
  attendeeId = existing?.id ?? null

  if (!attendeeId) {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('full_name, phone')
      .eq('id', userId)
      .maybeSingle()
    const { data: created, error: attendeeError } = await adminClient
      .from('attendees')
      .insert({
        event_id: device.event_id,
        user_id: userId,
        full_name: profile?.full_name ?? 'Asistente',
        phone: profile?.phone ?? null,
      })
      .select('id')
      .single()
    if (attendeeError || !created) return json({ ok: false, error: 'internal_error' }, 500)
    attendeeId = created.id
  }

  const { error: updateError } = await adminClient
    .from('devices')
    .update({
      status: 'active',
      assigned_attendee_id: attendeeId,
      assigned_at: new Date().toISOString(),
      paired_at: new Date().toISOString(),
      pairing_code: null,
      pairing_code_expires_at: null,
    })
    .eq('id', device.id)
  if (updateError) return json({ ok: false, error: 'internal_error' }, 500)

  const result: PairSuccess = {
    ok: true,
    device_id: device.id,
    device_uid: device.uid,
    device_type: device.type,
    event: { id: event.id, name: event.name, currency: event.currency },
  }
  return json(result, 200)
})
```

- [ ] **Step 2: Desplegar (usuario)**
  - Dashboard → Edge Functions → deploy el zip de `supabase/functions/` (o crear manualmente `pair-device` con el contenido, asegurando `_shared/` incluida si el dashboard la soporta como imports relativos — si no, subir el código con los imports `_shared` inline o colocar los helpers en la misma carpeta del deployable).

- [ ] **Step 3: Smoke test del endpoint**
  - Con un token de usuario autenticado (`ACCESS_TOKEN`), y un device en `unassigned` con `pairing_code` conocido:

```powershell
curl.exe -X POST "https://lhvqpymbgkjyfdcryhzp.supabase.co/functions/v1/pair-device" `
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" `
  -d '{"code":"<pairing_code>"}'
```

  - Expected: `200 {"ok":true,...,"event":{...}}`. Re-ejecutar → `409 {"ok":false,"error":"already_paired"}`.

---

### Task 4: Edge Functions `create-topup` + `stripe-webhook` + helper `notify`

**Files:**
- Create: `supabase/functions/create-topup/index.ts`
- Create: `supabase/functions/stripe-webhook/index.ts`
- Create: `supabase/functions/_shared/push.ts`

**Interfaces:**
- Consumes: `authenticateOperator`, `json`/`corsHeaders`, tabla `payment_requests`, RPC `topup` (0005/0010), tabla `profiles.push_token`, `events.currency`.
- Produces: `create-topup` → `POST .../create-topup` con body `{ device_id, amount }` → `200 { ok:true, session_url }`. `stripe-webhook` → `POST .../stripe-webhook` (firma Stripe) → `200 { ok:true }`. `_shared/push.ts` → `sendPushToUser(adminClient, userId, title, body, data?)`.

**Design:** `create-topup` valida propiedad vía RLS (userClient), inserta `payment_requests` (pending) con el cliente service_role de la Edge Function, crea Checkout Session de Stripe con la metadata necesaria para idempotencia, y devuelve la URL. `stripe-webhook` verifica la firma, reclama el `payment_requests` (pending→processing atómico), ejecuta `topup` y dispara la notificación. `push.ts` es el canal Expo.

- [ ] **Step 1: Escribir `_shared/push.ts`**

```ts
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export async function sendPushToUser(
  adminClient: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const { data: profile } = await adminClient
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.push_token) return

  await fetch(PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: profile.push_token, title, body, data }),
  })
}
```

- [ ] **Step 2: Escribir `create-topup/index.ts`**

```ts
// Edge Function `create-topup` — recarga online del asistente.
// Crea el payment_request (pending) y devuelve una Checkout Session de Stripe.
import Stripe from 'npm:stripe@17'
import { authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '')
const ZERO_DECIMAL_CURRENCIES = new Set(['CRC', 'JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX'])

function toStripeUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100)
}

interface TopupRequest {
  device_id: string
  amount: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: TopupRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const amount = Number(body.amount)
  if (!body.device_id || !Number.isFinite(amount) || amount <= 0) {
    return json({ ok: false, error: 'invalid_amount' }, 400)
  }

  // RLS: solo ve el device si le pertenece
  const { data: device } = await userClient
    .from('devices')
    .select('id, uid, status, event_id')
    .eq('id', body.device_id)
    .maybeSingle()
  if (!device || device.status !== 'active') return json({ ok: false, error: 'device_not_found' }, 404)

  const { data: event } = await adminClient
    .from('events')
    .select('name, currency')
    .eq('id', device.event_id)
    .maybeSingle()
  const currency = event?.currency ?? 'CRC'

  const { data: pr, error: prError } = await adminClient
    .from('payment_requests')
    .insert({
      profile_id: userId,
      device_id: device.id,
      device_uid: device.uid,
      event_id: device.event_id,
      amount,
      status: 'pending',
    })
    .select('id')
    .single()
  if (prError || !pr) return json({ ok: false, error: 'internal_error' }, 500)

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: toStripeUnits(amount, currency),
            product_data: { name: event?.name ?? 'PrismaCash — recarga' },
          },
        },
      ],
      metadata: {
        payment_request_id: pr.id,
        event_id: device.event_id,
        profile_id: userId,
        device_uid: device.uid,
      },
      success_url: 'prismacash://topup/result?status=success',
      cancel_url: 'prismacash://topup/result?status=cancel',
    })
  } catch (err) {
    console.error('stripe create session', err)
    await adminClient.from('payment_requests').update({ status: 'failed', error: 'stripe_error' }).eq('id', pr.id)
    return json({ ok: false, error: 'stripe_error' }, 502)
  }

  await adminClient.from('payment_requests').update({ stripe_checkout_id: session.id }).eq('id', pr.id)

  return json({ ok: true, session_url: session.url }, 200)
})
```

- [ ] **Step 3: Escribir `stripe-webhook/index.ts`**

```ts
// Edge Function `stripe-webhook` — confirmación asíncrona de recarga online.
import Stripe from 'npm:stripe@17'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { sendPushToUser } from '../_shared/push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const stripe = new Stripe(STRIPE_SECRET_KEY)
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const signature = req.headers.get('stripe-signature') ?? ''
  let payload: string
  try {
    payload = await req.text()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('stripe signature error', err)
    return json({ ok: false, error: 'invalid_signature' }, 400)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const prId = session.metadata?.payment_request_id
    if (!prId) return json({ ok: true })

    // reclamo atómico: solo un webhook tupla el pending→processing
    const { data: claimed } = await adminClient
      .from('payment_requests')
      .update({ status: 'processing' } as never)
      .eq('id', prId)
      .eq('status', 'pending')
      .select('id, device_uid, event_id, amount, profile_id')
      .maybeSingle()
    if (!claimed) return json({ ok: true }) // ya procesado o inexistente

    const { data: top, error: rpcError } = await adminClient.rpc('topup', {
      p_device_uid: claimed.device_uid,
      p_event_id: claimed.event_id,
      p_amount: claimed.amount,
      p_branch_id: null,
      p_attendant_id: claimed.profile_id,
      p_client_tx_id: null,
    })

    if (rpcError || !top?.ok) {
      await adminClient
        .from('payment_requests')
        .update({ status: 'failed', error: top?.error ?? rpcError?.message ?? 'topup_failed' })
        .eq('id', prId)
      return json({ ok: true })
    }

    await adminClient
      .from('payment_requests')
      .update({ status: 'succeeded', tx_id: top.tx_id, confirmed_at: new Date().toISOString() })
      .eq('id', prId)

    await sendPushToUser(adminClient, claimed.profile_id, 'Recarga confirmada', `Se agregaron ${claimed.amount} a tu saldo.`)
  }

  return json({ ok: true })
})
```

- [ ] **Step 4: Configurar secrets Stripe (usuario)**
  - Dashboard → Edge Functions → Environment Variables: `STRIPE_SECRET_KEY` = `sk_test_...`, `STRIPE_WEBHOOK_SECRET` = `whsec_...` (creado en Step 5).
  - Stripe Dashboard → Developers → Webhooks → "Add endpoint" → URL `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, eventos: `checkout.session.completed`. Copiar el signing secret.

- [ ] **Step 5: Desplegar + smoke test (usuario)**
  - Deploy zip de `supabase/functions/` completo (incluye `_shared/push.ts`).
  - Probar por la app o con un Checkout manual: iniciar sesión, recargar, completar pago de prueba (tarjeta `4242 4242 4242 4242`), verificar que el saldo subió y aparece `payment_requests` con `status='succeeded'` y `tx_id`.

---

### Task 5: Edge Function `process-refund`

**Files:**
- Create: `supabase/functions/process-refund/index.ts`

**Interfaces:**
- Consumes: `authenticateOperator`, `json`/`corsHeaders`, RPC `approve_refund(uuid,uuid)`, tabla `refund_requests`, `_shared/push.ts`.
- Produces: `POST .../process-refund` con body `{ refund_id, action: 'approve'|'reject' }` → `200 { ok:true, amount?, new_balance? }` o `404`/`409`/`403`.

**Design:** Solo `event_admin` del evento o `super_admin` procesa. Consulta el refund y su evento, validando el rol contra `profiles.role` y `event_admins`. Aprueba vía RPC (atómico) o rechaza con UPDATE directo. En ambos casos notifica al solicitante.

- [ ] **Step 1: Escribir la función**

```ts
// Edge Function `process-refund` — aprobar/rechazar solicitud de reembolso
// (admin de evento o super_admin). Aprobación = débito + ledger vía approve_refund().
import { authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { sendPushToUser } from '../_shared/push.ts'

interface ProcessRefundRequest {
  refund_id: string
  action: 'approve' | 'reject'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: ProcessRefundRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }
  if (!body.refund_id || !['approve', 'reject'].includes(body.action)) {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const { data: refund, error: refundError } = await adminClient
    .from('refund_requests')
    .select('id, device_id, amount, status, requested_by')
    .eq('id', body.refund_id)
    .maybeSingle()
  if (refundError || !refund) return json({ ok: false, error: 'not_found' }, 404)

  const { data: device } = await adminClient
    .from('devices')
    .select('event_id')
    .eq('id', refund.device_id)
    .maybeSingle()
  const eventId = device?.event_id ?? null

  const { data: profile } = await userClient.from('profiles').select('role').eq('id', userId).maybeSingle()
  const isSuper = profile?.role === 'super_admin'

  let isEventAdmin = false
  if (!isSuper && eventId) {
    const { data: adminLink } = await userClient
      .from('event_admins')
      .select('id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .maybeSingle()
    isEventAdmin = Boolean(adminLink)
  }
  if (!isSuper && !isEventAdmin) return json({ ok: false, error: 'forbidden' }, 403)

  if (body.action === 'approve') {
    const { data: res, error: rpcError } = await adminClient.rpc('approve_refund', {
      p_refund_id: body.refund_id,
      p_processed_by: userId,
    })
    if (rpcError || !res?.ok) return json({ ok: false, error: res?.error ?? 'internal_error' }, 409)

    await sendPushToUser(adminClient, refund.requested_by, 'Reembolso aprobado', `Tu solicitud de ${refund.amount} fue aprobada.`)
    return json({ ok: true, amount: res.amount, new_balance: res.new_balance })
  }

  const { error: rejectError } = await adminClient
    .from('refund_requests')
    .update({ status: 'rejected', processed_by: userId, processed_at: new Date().toISOString() })
    .eq('id', body.refund_id)
  if (rejectError) return json({ ok: false, error: 'internal_error' }, 500)

  await sendPushToUser(adminClient, refund.requested_by, 'Reembolso rechazado', 'Tu solicitud de reembolso fue rechazada.')
  return json({ ok: true, amount: refund.amount })
})
```

- [ ] **Step 2: Desplegar + smoke test (usuario)**
  - Deploy zip de `supabase/functions/` completo.
  - Probar con un usuario `event_admin`/`super_admin` sobre un `refund_requests` en `pending`: aprobar → saldo baja, `status='approved'`, web con status actualizada; rechazar → `status='rejected'`. Reintento de aprobar → `409 already_processed`.

---

### Task 6: PWA — Refunds aprueba/rechaza

**Files:**
- Modify: `src/pages/admin/Refunds.tsx`

**Interfaces:**
- Consumes: `readFunctionErrorCode` (`src/lib/functionError.ts`), `supabase.functions.invoke`, query `['admin-refunds', eventId]`.
- Produces: botones "Aprobar"/"Rechazar" para refunds `pending`; al hacer click invoca `process-refund` y refresca la lista. Feedback de error inline.

**Design:** Mantener el listado actual (solo lectura) y agregar acciones para las filas `pending`. Confirmación para ambas (diálogo `confirm()` base del navegador es suficiente para MVP). `canManage = role === 'super_admin' || role === 'event_admin'`.

- [ ] **Step 1: Actualizar `Refunds.tsx`**

Código completo del componente:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { useSessionRole } from '../../hooks/useSessionRole'
import { readFunctionErrorCode } from '../../lib/functionError'
import { supabase } from '../../lib/supabase'

interface RefundRow {
  id: string
  amount: number
  status: string
  created_at: string
  devices: { uid: string; attendees: { full_name: string } | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  paid: 'Pagado',
}

const STATUS_PILL: Record<string, string> = {
  pending: 'pill-gold',
  approved: 'pill-mute',
  rejected: 'pill-warn',
  paid: 'pill-ok',
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n)
}

export default function Refunds() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const role = useSessionRole()
  const queryClient = useQueryClient()
  const canManage = role === 'super_admin' || role === 'event_admin'

  const { data: refunds, isPending } = useQuery({
    queryKey: ['admin-refunds', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refund_requests')
        .select('id, amount, status, created_at, devices(uid, attendees(full_name))')
        .in(
          'device_id',
          (await supabase.from('devices').select('id').eq('event_id', eventId!)).data?.map((d) => d.id) ?? [],
        )
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as RefundRow[]
    },
  })

  const action = useMutation({
    mutationFn: async ({ id, action: act }: { id: string; action: 'approve' | 'reject' }) => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('process-refund', {
        body: { refund_id: id, action: act },
      })
      if (error) throw new Error((await readFunctionErrorCode(error)) ?? 'network')
      if (!data?.ok) throw new Error(data?.error ?? 'refund_failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-refunds', eventId] }),
  })

  const pendingError = action.isError && action.variables
    ? `No se pudo procesar el reembolso (${action.error?.message ?? 'error'}).`
    : null

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Reembolsos</h1>
        <span className="font-mono text-xs text-ink-faint">{refunds?.length ?? 0} solicitudes</span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {isPending && <p className="text-sm text-ink-faint">Cargando…</p>}
        {!isPending && refunds?.length === 0 && <p className="text-sm text-ink-faint">Sin solicitudes de reembolso.</p>}
        {pendingError && <p className="rounded-md border border-rust/30 bg-rust-bg px-3 py-2 text-sm text-rust">{pendingError}</p>}
        {refunds?.map((r) => (
          <div key={r.id} className="card flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-mono text-sm font-semibold">{formatMoney(r.amount)}</p>
              <p className="text-xs text-ink-soft">
                {r.devices?.attendees?.full_name ?? 'Asistente desconocido'} ·{' '}
                <span className="font-mono">{r.devices?.uid ?? '—'}</span>
              </p>
              <p className="text-xs text-ink-faint">
                {new Date(r.created_at).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={STATUS_PILL[r.status] ?? 'pill-mute'}>{STATUS_LABEL[r.status] ?? r.status}</span>
              {canManage && r.status === 'pending' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="cta-ok rounded-md px-3 py-1 text-xs font-bold disabled:opacity-50"
                    disabled={action.isPending}
                    onClick={() => {
                      if (confirm(`¿Aprobar reembolso de ${formatMoney(r.amount)}?`)) {
                        action.mutate({ id: r.id, action: 'approve' })
                      }
                    }}
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    className="cta-coral rounded-md px-3 py-1 text-xs font-bold disabled:opacity-50"
                    disabled={action.isPending}
                    onClick={() => {
                      if (confirm(`¿Rechazar reembolso de ${formatMoney(r.amount)}?`)) {
                        action.mutate({ id: r.id, action: 'reject' })
                      }
                    }}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificación**

```powershell
npm run build
npm run lint
```

- [ ] **Step 3: Commit**

```powershell
git add src/pages/admin/Refunds.tsx
git commit -m "feat(admin): aprobar/rechazar reembolsos via process-refund"
```

---

### Task 7: PWA — Quiosco imprime QR de emparejamiento

**Files:**
- Modify: `src/pages/Kiosk.tsx`
- Dep: `qrcode.react` (ya está en package.json)

**Interfaces:**
- Consumes: `issue_device` ahora devuelve `pairing_code` (Task 2), `QRCodeSVG` de `qrcode.react`.
- Produces: tras un alta exitosa en modo `new`, muestra un QR que codifica `prismacash://pair?code=<pairing_code>` para escanear desde la app.

**Design:** Agregar estado `pairingCode`; cuando `handleIssueOrTopup` recibe `data.pairing_code` en modo new, se muestra (y se mantiene tras limpiar el form hasta que el usuario lo oculte o cambie de modo).

- [ ] **Step 1: Modificar `Kiosk.tsx`**

Añadir import y estado:

```tsx
import { QRCodeSVG } from 'qrcode.react'
```

```tsx
const [pairingCode, setPairingCode] = useState<string | null>(null)
```

En `handleIssueOrTopup`, dentro del `if (mode === 'new')` del bloque de éxito, tras `setFeedback(...)`:

```tsx
setPairingCode('pairing_code' in data && (data as unknown as { pairing_code?: string }).pairing_code ? (data as unknown as { pairing_code: string }).pairing_code : null)
```

Y en `switchMode` resetear:

```tsx
setPairingCode(null)
```

Renderizar el QR entre el formulario y los feedback (después del `</form>`):

```tsx
{mode === 'new' && pairingCode && (
  <div className="card flex flex-col items-center gap-3 p-4">
    <p className="text-sm font-bold text-ink">Dispositivo listo para emparejar</p>
    <p className="text-xs text-ink-soft">El asistente escanea este QR desde la app PrismaCash para vincular su cuenta.</p>
    <QRCodeSVG value={`prismacash://pair?code=${pairingCode}`} size={190} />
    <span className="break-all font-mono text-[10px] text-ink-faint">{pairingCode}</span>
    <button type="button" onClick={() => setPairingCode(null)} className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink">
      Ocultar QR
    </button>
  </div>
)}
```

- [ ] **Step 2: Verificación**

```powershell
npm run build
npm run lint
```

- [ ] **Step 3: Commit**

```powershell
git add src/pages/Kiosk.tsx
git commit -m "feat(kiosk): mostrar QR de emparejamiento tras el alta"
```

---

### Task 8: Scaffold de `mobile/` + cliente Supabase + libs

**Files:**
- Create: `mobile/` (proyecto Expo completo, generado por create-expo-app)
- Create: `mobile/.env`, `mobile/.env.example`
- Create: `mobile/src/lib/supabase.ts`
- Create: `mobile/src/lib/api.ts`
- Create: `mobile/src/lib/functionError.ts`

**Interfaces:**
- Produces: `supabase` (cliente), `readFunctionErrorCode(error)`, `pairDevice(code)` → `PairResult`, `startTopup(deviceUid, amount)` → `{ ok:true, session_url } | throws Error(code)`, `invokeEdge<T>(fn, body)`.
- Consumes: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, y las Edge Functions de las Tasks 3-5.

**Design:** EL scaffold se genera con `create-expo-app` (template por defecto = expo-router + TS). Se añaden las cantidades mínimas de libs. El `.env` se crea con las mismas credenciales del proyecto Supabase que la PWA.

- [ ] **Step 1: Generar el proyecto Expo**

```powershell
npx create-expo-app@latest mobile --template blank-typescript
```

(El template `blank-typescript` es mínimo; luego instalaremos `expo-router` como dependencia y estructura de carpetas manualmente, que es más predecible que el template `default` con tabs.)

- [ ] **Step 2: Instalar dependencias**

Dentro de `mobile/`:

```powershell
npx expo install @supabase/supabase-js @tanstack/react-query @react-native-async-storage/async-storage expo-camera expo-web-browser expo-notifications expo-screen-brightness react-native-qrcode-svg
```

Y para testing (dev):

```powershell
npx expo install jest-expo jest @types/jest -- --save-dev
```

- [ ] **Step 3: Configurar script test + jest preset en `mobile/package.json`**

```jsonc
// dentro de mobile/package.json
"scripts": {
  "test": "jest"
},
"jest": {
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@supabase))"
  ]
}
```

- [ ] **Step 4: Crear `.env.example`**

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Y `.env` (copiar valores reales de la PWA, mismas credenciales `lhvqpymbgkjyfdcryhzp`).

Añadir a `mobile/.gitignore` (create-expo-app ya lo genera) y NO versionar `.env`.

- [ ] **Step 5: Escribir `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY en mobile/.env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

- [ ] **Step 6: Escribir `src/lib/functionError.ts`**

```ts
import { FunctionsHttpError } from '@supabase/supabase-js'

export async function readFunctionErrorCode(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null
  try {
    const body = await error.context.json()
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
```

- [ ] **Step 7: Escribir `src/lib/api.ts`**

```ts
import { supabase } from './supabase'
import { readFunctionErrorCode } from './functionError'

export interface PairResult {
  ok: true
  device_id: string
  device_uid: string
  device_type: 'nfc' | 'qr' | 'hybrid'
  event: { id: string; name: string; currency: string }
}

export async function invokeEdge<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body })
  if (error) {
    const code = await readFunctionErrorCode(error)
    throw new Error(code ?? 'network')
  }
  if (!data || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { error?: string })?.error ?? 'unknown')
  }
  return data
}

export function pairDevice(code: string) {
  return invokeEdge<PairResult>('pair-device', { code })
}

export async function startTopup(deviceId: string, amount: number) {
  const data = await invokeEdge<{ ok: true; session_url: string }>('create-topup', { device_id: deviceId, amount })
  return data
}
```

- [ ] **Step 8: Verificación**

```powershell
npx tsc --noEmit
```

- [ ] **Step 9: Commit (desde la raíz del repo)**

```powershell
git add mobile
git commit -m "feat(mobile): scaffold Expo + cliente supabase + api"
```

---

### Task 9: Mobile — Auth (login + registro + push token)

**Files:**
- Create: `mobile/app/_layout.tsx` (root)
- Create: `mobile/app/login.tsx`
- Create: `mobile/app/register.tsx`
- Create: `mobile/app/index.tsx` (router)
- Create: `mobile/src/lib/auth.tsx`

**Interfaces:**
- Consumes: `supabase`, `registerPushToken()` (Task define abajo), `useEventContext` (Task 10 — para no usarla aún, login solo navega).
- Produces: `AuthProvider` + `useAuth()` (session), rutas `/login` y `/register`, guard de sesión en `index`.

**Design:** `AuthProvider` escucha `onAuthStateChange` y expone `session/user/loading`. `login.tsx` y `register.tsx` son formularios controlados. `register.tsx` tras `signUp` inserta el perfil `attendee` (vía RLS `self_insert_profile`). `index.tsx` redirige según sesión.

- [ ] **Step 1: Escribir `src/lib/auth.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthValue {
  session: Session | null
  loading: boolean
}

const AuthContext = createContext<AuthValue>({ session: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
```

- [ ] **Step 2: Escribir `src/lib/notifications.ts`**

```ts
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'

export async function registerPushToken(): Promise<void> {
  const existing = await Notifications.getPermissionsAsync()
  if (!existing.granted) {
    const req = await Notifications.requestPermissionsAsync()
    if (!req.granted) return
  }
  const token = await Notifications.getExpoPushTokenAsync()
  await supabase.rpc('save_push_token', { p_token: token.data })
}
```

- [ ] **Step 3: Escribir `app/_layout.tsx`**

```tsx
import { Slot } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../src/lib/auth'

const queryClient = new QueryClient()

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Slot />
      </AuthProvider>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 4: Escribir `app/index.tsx`**

```tsx
import { Redirect } from 'expo-router'
import { useAuth } from '../src/lib/auth'

export default function Index() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Redirect href="/login" />
  return <Redirect href="/pair" />
}
```

- [ ] **Step 5: Escribir `app/login.tsx`**

```tsx
import { useState } from 'react'
import { Link, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { supabase } from '../src/lib/supabase'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError) {
      setError('Correo o contraseña incorrectos.')
      return
    }
    router.replace('/pair')
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PrismaCash</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Correo" autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Contraseña" secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Entrando…' : 'Entrar'}</Text>
      </Pressable>
      <Link href="/register" style={styles.link}>¿Sin cuenta? Regístrate</Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 16 },
  error: { color: '#b91c1c', textAlign: 'center' },
  button: { backgroundColor: '#f59e0b', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  link: { textAlign: 'center', color: '#7c3aed', marginTop: 8 },
})
```

- [ ] **Step 6: Escribir `app/register.tsx`**

```tsx
import { useState } from 'react'
import { Link, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { supabase } from '../src/lib/supabase'

export default function Register() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setError(null)
    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }
    const user = data.user
    if (user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: user.id,
        full_name: fullName,
        role: 'attendee',
      })
      if (profileError) setError('No se pudo crear tu perfil.')
    }
    setLoading(false)
    router.replace('/pair')
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Crear cuenta</Text>
      <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Nombre completo" />
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Correo" autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Contraseña (mín. 6)" secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creando…' : 'Crear cuenta'}</Text>
      </Pressable>
      <Link href="/login" style={styles.link}>¿Ya tienes cuenta? Inicia sesión</Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 16 },
  error: { color: '#b91c1c', textAlign: 'center' },
  button: { backgroundColor: '#f59e0b', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  link: { textAlign: 'center', color: '#7c3aed', marginTop: 8 },
})
```

- [ ] **Step 7: Verificación**

```powershell
npx tsc --noEmit
```

**Nota:** los `styles` duplicados entre pantallas son intencionales (sin librería de tema todavía); si el reviewer los rechaza, mover a `src/theme.ts` compartido (no crítico para funcionalidad).

- [ ] **Step 8: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): auth (login+registro) y push token"
```

---

### Task 10: Mobile — EventContext + pantalla de emparejamiento

**Files:**
- Create: `mobile/src/context/EventContext.tsx`
- Create: `mobile/app/pair.tsx`
- Modify: `mobile/app/index.tsx` (redirige a tabs si ya hay evento activo)

**Interfaces:**
- Consumes: `pairDevice` (Task 8), `AsyncStorage`, `expo-camera`, `useAuth`.
- Produces: `useEventContext()` → `{ active: ActiveEvent|null, loading, pair(code), clear() }`, ruta `/pair`.
- `ActiveEvent`:
```ts
interface ActiveEvent {
  deviceId: string
  deviceUid: string
  deviceType: 'nfc' | 'qr' | 'hybrid'
  eventId: string
  eventName: string
  currency: string
}
```

**Design:** `EventContext` persiste el evento activo en AsyncStorage (un evento a la vez). `pair.tsx` escanea el QR (cámara) que contiene `prismacash://pair?code=...`, extrae el code, llama `pair-device` y guarda. Si ya hay evento activo, `index` va a tabs y Ajustes permite "cambiar evento" (reescanear) o "cerrar sesión".

- [ ] **Step 1: Escribir `src/context/EventContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { pairDevice, type PairResult } from '../lib/api'

export interface ActiveEvent {
  deviceId: string
  deviceUid: string
  deviceType: 'nfc' | 'qr' | 'hybrid'
  eventId: string
  eventName: string
  currency: string
}

interface EventContextValue {
  active: ActiveEvent | null
  loading: boolean
  pair: (code: string) => Promise<void>
  clear: () => Promise<void>
}

const STORAGE_KEY = 'prismacash.activeEvent'
const Ctx = createContext<EventContextValue | null>(null)

function toActiveEvent(res: PairResult & { ok: true }): ActiveEvent {
  return {
    deviceId: res.device_id,
    deviceUid: res.device_uid,
    deviceType: res.device_type,
    eventId: res.event.id,
    eventName: res.event.name,
    currency: res.event.currency,
  }
}

export function EventProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveEvent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => (raw ? setActive(JSON.parse(raw) as ActiveEvent) : null))
      .finally(() => setLoading(false))
  }, [])

  const persist = (ev: ActiveEvent | null) => {
    setActive(ev)
    if (ev) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ev))
    else AsyncStorage.removeItem(STORAGE_KEY)
  }

  const pair = async (code: string) => {
    const res = await pairDevice(code)
    if ('ok' in res && res.ok) persist(toActiveEvent(res))
    else throw new Error('pair_failed')
  }

  const clear = async () => persist(null)

  return <Ctx.Provider value={{ active, loading, pair, clear }}>{children}</Ctx.Provider>
}

export function useEventContext() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEventContext sin EventProvider')
  return ctx
}
```

- [ ] **Step 2: Registrar `EventProvider` en `app/_layout.tsx`** (envolver junto a `AuthProvider`).

- [ ] **Step 3: Escribir `app/pair.tsx`**

```tsx
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { ActivityIndicator, Text, View } from 'react-native'
import { useEventContext } from '../src/context/EventContext'

function extractCode(payload: string): string | null {
  const match = payload.match(/[?&]code=([^&]+)/)
  return match ? decodeURIComponent(match[1]) : payload
}

export default function Pair() {
  const [permission, requestPermission] = useCameraPermissions()
  const { pair } = useEventContext()
  const router = useRouter()
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!permission) return <View style={{ flex: 1 }} />
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center', marginBottom: 12 }}>
          Necesitamos la cámara para escanear el QR de tu dispositivo.
        </Text>
        <Text onPress={requestPermission} style={{ color: '#7c3aed', fontWeight: '700' }}>
          Autorizar cámara
        </Text>
      </View>
    )
  }

  async function onBarcodeScanned(ev: { data: string }) {
    if (pairing) return
    setPairing(true)
    setError(null)
    const code = extractCode(ev.data)
    if (!code) {
      setError('QR no válido.')
      setPairing(false)
      return
    }
    try {
      await pair(code)
      router.replace('/')
    } catch (e) {
      setError((e as Error).message === 'not_found' ? 'Código no encontrado.' : 'Error al emparejar.')
      setPairing(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={onBarcodeScanned} />
      <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
        {pairing && <ActivityIndicator size="large" color="#7c3aed" />}
        {error && <Text style={{ backgroundColor: '#fff', padding: 8, borderRadius: 8 }}>{error}</Text>}
        <Text style={{ color: '#fff', fontWeight: '600', marginTop: 8 }}>
          Escanea el QR impreso al comprar tu dispositivo
        </Text>
      </View>
    </View>
  )
}
```

Exportar `extractCode` (que define la Task 11 como unidad testeable) — reubicar a `src/lib/pairCode.ts` con su test en la Task 11.

- [ ] **Step 4: Actualizar `app/index.tsx` para enrutar según evento activo**

```tsx
import { Redirect } from 'expo-router'
import { useAuth } from '../src/lib/auth'
import { useEventContext } from '../src/context/EventContext'

export default function Index() {
  const { session, loading } = useAuth()
  const { active, loading: eventLoading } = useEventContext()

  if (loading || eventLoading) return null
  if (!session) return <Redirect href="/login" />
  if (!active) return <Redirect href="/pair" />
  return <Redirect href="/(tabs)" />
}
```

- [ ] **Step 5: Verificación**

```powershell
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): evento activo + emparejamiento por QR"
```

---

### Task 11: Mobile — tabs Mi QR + Ajustes + helper extractCode testeado

**Files:**
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/qr.tsx`
- Create: `mobile/app/(tabs)/settings.tsx`
- Create: `mobile/src/lib/pairCode.ts`
- Create: `mobile/src/lib/pairCode.test.ts`
- Modify: `mobile/app/pair.tsx` (usar `extractCode` de lib)

**Interfaces:**
- Consumes: `useEventContext`, `react-native-qrcode-svg`, `expo-screen-brightness`.
- Produces: `extractCode(payload: string): string | null`, tabs `qr` + `settings`. Ajustes: ver evento activo, "Cambiar de evento" (→ `/pair`), "Cerrar sesión" (`supabase.auth.signOut` + `clear()`).

**Design:** El QR de "Mi QR" codifica el `device_uid` (mismo contrato que el POS). Al enfocarlo se sube el brillo al máximo; al salir se restaura. `extractCode` es una función pura extractada para poder testearla.

- [ ] **Step 1: Escribir `src/lib/pairCode.ts`**

```ts
export function extractCode(payload: string): string | null {
  const match = payload.match(/[?&]code=([^&]+)/)
  return match ? decodeURIComponent(match[1]) : payload.length ? payload : null
}
```

- [ ] **Step 2: Escribir `src/lib/pairCode.test.ts`**

```ts
import { extractCode } from './pairCode'

describe('extractCode', () => {
  it('extrae el code de un deep link', () => {
    expect(extractCode('prismacash://pair?code=abc-123')).toBe('abc-123')
  })
  it('extrae el code con query extra', () => {
    expect(extractCode('prismacash://pair?code=xyz&utm=x')).toBe('xyz')
  })
  it('devuelve el payload si no es deep link', () => {
    expect(extractCode('raw-code')).toBe('raw-code')
  })
  it('devuelve null en vacío', () => {
    expect(extractCode('')).toBeNull()
  })
})
```

- [ ] **Step 3: Actualizar `pair.tsx` para importar `extractCode` de `lib/pairCode`** y eliminar la función local.

- [ ] **Step 4: Escribir `app/(tabs)/_layout.tsx`**

```tsx
import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="qr" options={{ title: 'Mi QR' }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes' }} />
    </Tabs>
  )
}
```

(NOT-historias posteriores agregarán las tabs history/topup/refund en sus Tasks.)

- [ ] **Step 5: Escribir `app/(tabs)/qr.tsx`**

```tsx
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { Text, View, StyleSheet } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import * as ScreenBrightness from 'expo-screen-brightness'
import { useEventContext } from '../../src/context/EventContext'

export default function QrScreen() {
  const { active } = useEventContext()
  const currency = active?.currency ?? 'CRC'

  // placeholder provisional -> Task 12 lo sustituye por el hook useDevice()
  const [balance, setBalance] = useState<number | null>(null)

  useFocusEffect(
    useCallback(() => {
      ScreenBrightness.setBrightnessAsync(1).catch(() => {})
      return () => {
        ScreenBrightness.setBrightnessAsync(0.5).catch(() => {})
      }
    }, []),
  )

  if (!active) return <Text>Sin dispositivo activo.</Text>

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{active.eventName}</Text>
      <View style={styles.qrBox}>
        <QRCode value={active.deviceUid} size={220} />
      </View>
      <Text style={styles.wallet}>Saldo: {formatMoney(balance ?? 0, currency)}</Text>
      <Text style={styles.mono}>{active.deviceUid}</Text>
    </View>
  )
}

function formatMoney(n: number, currency: string) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  label: { fontSize: 20, fontWeight: '800' },
  qrBox: { padding: 16, backgroundColor: '#fff', borderRadius: 16 },
  wallet: { fontSize: 22, fontWeight: '800', color: '#1a7f5b' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#666' },
})
```

Nota: el placeholder `useState` de `qr.tsx` es provisional; la Task 12 lo sustituye por `useDevice(active)`. En esta Task queda autocontenido y compila.

- [ ] **Step 6: Escribir `app/(tabs)/settings.tsx`**

```tsx
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/lib/auth'
import { useEventContext } from '../../src/context/EventContext'

export default function Settings() {
  const router = useRouter()
  const { session } = useAuth()
  const { active, clear } = useEventContext()

  async function handleLogout() {
    await supabase.auth.signOut()
    await clear()
    router.replace('/login')
  }

  return (
    <View style={styles.container}>
      <Text style={styles.section}>Cuenta</Text>
      <Text style={styles.email}>{session?.user?.email}</Text>

      <Text style={styles.section}>Evento activo</Text>
      <Text style={styles.event}>{active ? `${active.eventName} · ${active.deviceUid}` : 'Sin dispositivo'}</Text>
      <Pressable style={styles.buttonGhost} onPress={() => router.push('/pair')}>
        <Text style={styles.buttonGhostText}>Cambiar de evento</Text>
      </Pressable>

      <Pressable style={styles.buttonLogout} onPress={handleLogout}>
        <Text style={styles.buttonLogoutText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  section: { marginTop: 12, fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase' },
  email: { fontSize: 16, fontWeight: '600' },
  event: { fontSize: 14, color: '#555' },
  buttonGhost: { marginTop: 8, alignSelf: 'flex-start', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#7c3aed' },
  buttonGhostText: { color: '#7c3aed', fontWeight: '700' },
  buttonLogout: { marginTop: 24, padding: 14, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center' },
  buttonLogoutText: { color: '#b91c1c', fontWeight: '700' },
})
```

- [ ] **Step 7: Test + tsc**

```powershell
npx jest
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): Mi QR + ajustes + extractCode test"
```

---

### Task 12: Mobile — Hook de saldo + Historial

**Files:**
- Create: `mobile/src/hooks/useDevice.ts`
- Create: `mobile/app/(tabs)/history.tsx`
- Modify: `mobile/app/(tabs)/qr.tsx` (usar el hook)
- Modify: `mobile/app/(tabs)/_layout.tsx` (añadir tab `history`)

**Interfaces:**
- Consumes: `active` de `useEventContext`, `supabase`, react-query.
- Produces: `useDevice(active)` → `{ device, balance, isLoading }` y `useHistory(active)` → `{ txs, isLoading }`.

**Design:** RLS de la migración 0014 garantiza que el asistente solo ve lo suyo. Queries por `device_id`.

- [ ] **Step 1: Escribir `src/hooks/useDevice.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ActiveEvent } from '../context/EventContext'

export function useDevice(active: ActiveEvent | null) {
  return useQuery({
    queryKey: ['device', active?.deviceId],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('id, uid, type, status, wallets(balance)')
        .eq('id', active!.deviceId)
        .single()
      if (error) throw error
      return data as { id: string; uid: string; type: string; status: string; wallets: { balance: number } | null }
    },
  })
}

export function useHistory(active: ActiveEvent | null) {
  return useQuery({
    queryKey: ['history', active?.deviceId],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, type, amount, balance_before, balance_after, created_at')
        .eq('device_id', active!.deviceId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as { id: string; type: string; amount: number; balance_before: number; balance_after: number; created_at: string }[]
    },
  })
}
```

- [ ] **Step 2: Actualizar `qr.tsx`** — sustituir estado local por `useDevice(active)`:

```tsx
const { data: device } = useDevice(active)
const balance = device?.wallets?.balance ?? 0
```

- [ ] **Step 3: Escribir `app/(tabs)/history.tsx`**

```tsx
import { Text, View, StyleSheet, FlatList } from 'react-native'
import { useEventContext } from '../../src/context/EventContext'
import { useHistory } from '../../src/hooks/useDevice'

const TYPE_LABEL: Record<string, string> = {
  initial_load: 'Carga inicial',
  topup: 'Recarga',
  payment: 'Pago',
  refund: 'Reembolso',
  migration_in: 'Migración entrante',
  migration_out: 'Migración saliente',
  adjustment: 'Ajuste',
}

export default function History() {
  const { active } = useEventContext()
  const { data: txs, isLoading } = useHistory(active)
  const currency = active?.currency ?? 'CRC'

  if (isLoading) return <Text style={{ padding: 24 }}>Cargando…</Text>
  if (!txs?.length) return <Text style={{ padding: 24 }}>Sin movimientos.</Text>

  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={txs}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.type}>{TYPE_LABEL[item.type] ?? item.type}</Text>
            <Text style={styles.date}>
              {new Date(item.created_at).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })}
            </Text>
            <Text style={styles.balance}>Saldo posterior: {formatMoney(item.balance_after, currency)}</Text>
          </View>
          <Text style={item.type === 'payment' || item.type === 'refund' ? styles.neg : styles.pos}>
            {item.type === 'payment' || item.type === 'refund' ? '-' : '+'}
            {formatMoney(item.amount, currency)}
          </Text>
        </View>
      )}
    />
  )
}

function formatMoney(n: number, currency: string) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', padding: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10 },
  type: { fontSize: 15, fontWeight: '700' },
  date: { fontSize: 12, color: '#888', marginTop: 2 },
  balance: { fontSize: 12, color: '#666', marginTop: 2 },
  pos: { fontSize: 16, fontWeight: '800', color: '#1a7f5b' },
  neg: { fontSize: 16, fontWeight: '800', color: '#b91c1c' },
})
```

- [ ] **Step 4: Añadir tab `history` en `_layout.tsx`**

```tsx
<Tabs.Screen name="history" options={{ title: 'Historial' }} />
```

- [ ] **Step 5: Verificación**

```powershell
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): saldo + historial"
```

---

### Task 13: Mobile — Recarga (Stripe Checkout)

**Files:**
- Create: `mobile/app/(tabs)/topup.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx` (tab `topup`)

**Interfaces:**
- Consumes: `startTopup` (Task 8), `expo-web-browser`, `useEventContext`, `useDevice` (saldo), `useQueryClient`.
- Produces: tab `topup` con montos rápidos + importe editable; abre `session_url` con `openAuthSessionAsync`; invalida queries de saldo/historial al volver; muestra estado de recargas recientes desde `payment_requests`.

**Design:** Flujo: elegir monto → `startTopup(deviceUid, amount)` → abrir el checkout → al regresar, invalidar queries (el saldo se actualiza cuando `stripe-webhook` ejecuta `topup`). Persistimos una cola local de "en espera" para UX.

- [ ] **Step 1: Escribir `app/(tabs)/topup.tsx`**

```tsx
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useQueryClient } from '@tanstack/react-query'
import { useEventContext } from '../../src/context/EventContext'
import { startTopup } from '../../src/lib/api'

const QUICK = [5000, 10000, 20000]

export default function Topup() {
  const { active } = useEventContext()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('10000')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function handleTopup() {
    if (!active) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Monto inválido.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await startTopup(active.deviceId, value)
      setLoading(false)
      setPending(true)
      setStatus('Confirmando el pago…')
      const result = await WebBrowser.openAuthSessionAsync(res.session_url, 'prismacash://topup/result')
      setPending(false)
      if (result.type === 'success') {
        setStatus('Pago completado. Actualizando saldo…')
        await queryClient.invalidateQueries()
        setTimeout(() => setStatus('Recarga solicitada. El saldo se actualiza al confirmarse el pago.'), 1500)
      } else {
        setStatus('Pago cancelado o no completado.')
      }
    } catch (e) {
      setLoading(false)
      const code = (e as Error).message
      setError(code === 'stripe_error' ? 'No se pudo iniciar el pago.' : 'Error de conexión.')
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recargar saldo</Text>
      <View style={styles.quickRow}>
        {QUICK.map((v) => (
          <Pressable
            key={v}
            style={[styles.quick, amount === String(v) && styles.quickActive]}
            onPress={() => { setAmount(String(v)); setError(null) }}
          >
            <Text style={amount === String(v) ? styles.quickTextActive : styles.quickText}>{v.toLocaleString('es-CR')}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="₡"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {status && <Text style={styles.status}>{status}</Text>}
      <Pressable style={[styles.button, loading && { opacity: 0.6 }]} onPress={handleTopup} disabled={loading || pending}>
        <Text style={styles.buttonText}>{loading || pending ? 'Procesando…' : `Recargar ₡${Number(amount || 0).toLocaleString('es-CR')}`}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quick: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center' },
  quickActive: { backgroundColor: '#fef3c7', borderColor: '#f59e0b' },
  quickText: { fontWeight: '600' },
  quickTextActive: { fontWeight: '800', color: '#b45309' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 18 },
  error: { color: '#b91c1c' },
  status: { color: '#555', fontStyle: 'italic' },
  button: { backgroundColor: '#f59e0b', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
})
```

- [ ] **Step 2: Añadir tab `topup` en `_layout.tsx`**

```tsx
<Tabs.Screen name="topup" options={{ title: 'Recargar' }} />
```

- [ ] **Step 3: Verificación**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): recarga online con Stripe Checkout"
```

---

### Task 14: Mobile — Solicitud de reembolso

**Files:**
- Create: `mobile/app/(tabs)/refund.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx` (tab `refund`)

**Interfaces:**
- Consumes: `useDevice` (saldo), `supabase` (`refund_requests` insert/select), `useQueryClient`.
- Produces: tab `refund` con formulario (importe ≤ saldo) que inserta `refund_requests` y lista las solicitudes del usuario con su estado.

**Design:** Depende de las políticas `owner_create_refunds`/`owner_read_refunds` (riz de 0014). `requested_by` = `auth.uuid()` (= `profiles.id`).

- [ ] **Step 1: Escribir `app/(tabs)/refund.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../src/lib/supabase'
import { useEventContext } from '../../src/context/EventContext'
import { useDevice } from '../../src/hooks/useDevice'

const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', paid: 'Pagado' }

export default function Refund() {
  const { active } = useEventContext()
  const queryClient = useQueryClient()
  const { data: device } = useDevice(active)
  const balance = device?.wallets?.balance ?? 0
  const currency = active?.currency ?? 'CRC'
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: requests, isLoading } = useQuery({
    queryKey: ['my-refunds', active?.deviceId],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refund_requests')
        .select('id, amount, status, created_at')
        .eq('device_id', active!.deviceId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as { id: string; amount: number; status: string; created_at: string }[]
    },
  })

  const max = useMemo(() => balance, [balance])

  async function handleSubmit() {
    if (!active) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Monto inválido.')
      return
    }
    if (value > max) {
      setError(`El importe supera tu saldo (${max.toLocaleString('es-CR')}).`)
      return
    }
    setSubmitting(true)
    setError(null)
    const { error: insertError } = await supabase.from('refund_requests').insert({
      device_id: active.deviceId,
      amount: value,
      requested_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    setSubmitting(false)
    if (insertError) {
      setError('No se pudo enviar la solicitud.')
      return
    }
    setAmount('')
    queryClient.invalidateQueries({ queryKey: ['my-refunds', active.deviceId] })
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Solicitar reembolso</Text>
      <Text style={styles.balance}>Saldo actual: {balance.toLocaleString('es-CR')} {currency}</Text>

      <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="Monto a reembolsar" />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
        <Text style={styles.buttonText}>{submitting ? 'Enviando…' : 'Solicitar reembolso'}</Text>
      </Pressable>

      <Text style={styles.section}>Mis solicitudes</Text>
      {isLoading && <Text>Cargando…</Text>}
      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowAmount}>{item.amount.toLocaleString('es-CR')} {currency}</Text>
              <Text style={styles.rowDate}>{new Date(item.created_at).toLocaleString('es-CR', { dateStyle: 'short' })}</Text>
            </View>
            <Text style={item.status === 'pending' ? styles.pillPending : item.status === 'approved' ? styles.pillOk : styles.pillBad}>
              {STATUS_LABEL[item.status] ?? item.status}
            </Text>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 10 },
  title: { fontSize: 24, fontWeight: '800' },
  balance: { fontSize: 15, color: '#555' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 18 },
  error: { color: '#b91c1c' },
  button: { backgroundColor: '#f59e0b', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  section: { marginTop: 16, fontWeight: '700', fontSize: 13, color: '#888', textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10 },
  rowAmount: { fontSize: 15, fontWeight: '700' },
  rowDate: { fontSize: 12, color: '#888' },
  pillPending: { fontWeight: '800', color: '#b45309' },
  pillOk: { fontWeight: '800', color: '#1a7f5b' },
  pillBad: { fontWeight: '800', color: '#b91c1c' },
})
```

- [ ] **Step 2: Añadir tab `refund` en `_layout.tsx`**

```tsx
<Tabs.Screen name="refund" options={{ title: 'Reembolso' }} />
```

- [ ] **Step 3: Verificación**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): solicitud de reembolso"
```

---

### Task 15: Push al login + configuración EAS + build de verificación

**Files:**
- Modify: `mobile/app/login.tsx` (llamar `registerPushToken()` tras login)
- Create: `mobile/app.json` (scheme `prismacash`, plugins), `mobile/eas.json`
- Create: `mobile/app/(tabs)/_layout.tsx` (ya existe) — sin cambios
- Docs: `docs/HANDOFF.md` (raíz), memoria

**Interfaces:**
- Consumes: `registerPushToken` (Task 9), `supabase`.
- Produces: config EAS para buildeo por nube.

**Design:** Se registra el push token una vez por login (idempotente: si el permiso no se otorga, no rompe). Configuración mínima de EAS para builds cloud.

- [ ] **Step 1: Llamar `registerPushToken` en `login.tsx`** tras éxito, sin bloquear UX

```tsx
import { registerPushToken } from '../src/lib/notifications'
...
router.replace('/pair')
registerPushToken().catch(() => {})
```

- [ ] **Step 2: Llamar también en `register.tsx`** (mismo patrón tras crear el perfil).

- [ ] **Step 3: Configurar `app.json`**

```json
{
  "expo": {
    "name": "PrismaCash",
    "slug": "prismacash-mobile",
    "scheme": "prismacash",
    "version": "1.0.0",
    "orientation": "portrait",
    "plugins": ["expo-router", "expo-notifications"],
    "ios": { "supportsTablet": true },
    "android": { "package": "io.prismacash.mobile" }
  }
}
```

- [ ] **Step 4: Crear `eas.json`**

```json
{
  "cli": { "version": ">= 3.0.0" },
  "build": {
    "preview": { "distribution": "internal" },
    "production": {}
  }
}
```

- [ ] **Step 5: Verificación completa (raíz + mobile)**

```powershell
npm run build   # raíz PWA
npm run lint    # raíz PWA
Set-Location mobile  # o usar workdir
npx tsc --noEmit
npx jest
npx expo export --platform android  # verifica que el bundle Expo compila
npx expo export --platform ios
```

- [ ] **Step 6: Commit**

```powershell
git add mobile
git commit -m "feat(mobile): push token al login + config EAS"
```

---

### Task 16: E2E + vínculos reales + actualizar memoria/HANDOFF

**Files:**
- Modify: `docs/HANDOFF.md`, memoria del proyecto

**Design:** Pruebas manuales en vivo (requieren dispositivo físico o emulador con Expo Go, y las migraciones/Edge Functions desplegadas). Todo lo del MVP debe reflejarse en HANDOFF.

- [ ] **Step 1: Checklist E2E manual**

1. Registro en la app (email+password) → profile `attendee` creado.
2. En quiosco PWA (super_admin) en modo "Nuevo": crear dispositivo → se muestra QR de emparejamiento.
3. En la app: escanear ese QR → emparejado, aparece el evento.
4. Mi QR muestra el `device_uid`; el POS escanea ese mismo QR y cobra (como con cualquier QR).
5. Saldo e historial reflejan cobros/recargas.
6. Recarga: elegir monto → checkout Stripe (tarjeta de prueba `4242...`) → al volver, saldo sube y webhook registra `payment_requests` `succeeded`.
7. Reembolso en la app → aparece `pending` en admin Refunds → aprobar (baja saldo, ledger `refund`) → push "Reembolso aprobado".
8. Rechazar una solicitud → status `rejected` + push.
9. Cambiar de evento (escanear QR de otro evento) y cerrar sesión.

- [ ] **Step 2: Registrar discrepancias y fixearlas en la rama** (cada fix con su commit y `npm run build`/`npx tsc --noEmit` de referencia).

- [ ] **Step 3: Actualizar `docs/HANDOFF.md`** — nueva sección "App móvil (Fase 2)" con stack, rama feature, cómo desplegar migración/Edge Functions/EAS, y pendientes.

- [ ] **Step 4: Commit docs**

```powershell
git add docs
git commit -m "docs: handoff app movil (Fase 2)"
```

- [ ] **Step 5: Preparar para merge** — verificar que la rama solo contiene los cambios esperados y dejar listo el PR/mr al branch `main` (el merge en sí NO se hace hasta aprobación del usuario).

---

## Self-review del plan

**Cobertura de spec:**
- Login/registro email+password → Tasks 8-9. ✅
- Emparejamiento QR (pairing_code, deep link, one-shot 48h) → Tasks 2-3, 10, 7 (quiosco). ✅
- Un evento a la vez (EventContext + "Cambiar de evento") → Tasks 10, 11. ✅
- Mi QR (device_uid), saldo, historial → Tasks 11, 12. ✅
- Recarga Stripe Checkout web + webhook idempotente → Tasks 4, 13. ✅
- Reembolso (app + admin aprueba/rechaza) → Tasks 5, 6, 14. ✅
- Notificaciones push (topup confirm + refund) → Tasks 4, 5, 9, 15. ✅
- RLS asistente (solo lo suyo) → Task 2. ✅
- EAS config → Task 15. ✅

**Placeholders:** ninguno; todos los pasos tienen código o comando verificable.

**Consistencia de tipos:**
- `pairDevice` devuelve `PairResult` (Task 8) consumida por Task 10. ✅
- `ActiveEvent` (Task 10) consumida por Tasks 11-14. ✅
- `startTopup` (Task 8) consumida por Task 13. ✅
- `extractCode` creada en Task 11 y usada por `pair.tsx` (Task 10 → se actualiza en Task 11). ✅
- `save_push_token(text)` RPC (Task 2) consumida por `registerPushToken` (Task 9). ✅
- `approve_refund(uuid,uuid)` RPC (Task 2) usada por `process-refund` (Task 5). ✅
- `process-refund` (Task 5) consumida por Refunds.tsx (Task 6). ✅
- `topup` RPC reusable (existe en 0010) usada por `stripe-webhook` (Task 4). ✅