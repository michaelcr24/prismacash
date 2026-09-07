-- PrismaCash — esquema inicial
-- Ver PLAN-IMPLEMENTACION.md sección 4 (modelo de datos) y sección 7 (RLS).

-- ══════════════════════════════════════════════════════════════════
-- ENUMS
-- ══════════════════════════════════════════════════════════════════
create type event_status as enum ('draft', 'active', 'closed');
create type device_kind as enum ('nfc', 'qr', 'hybrid');
create type branch_kind as enum ('recharge_kiosk', 'sales_point', 'both');
create type user_role as enum ('super_admin', 'event_admin', 'operator');
create type device_status as enum ('unassigned', 'active', 'blocked', 'retired');
create type transaction_type as enum (
  'initial_load', 'topup', 'payment', 'refund',
  'migration_out', 'migration_in', 'adjustment'
);
create type refund_status as enum ('pending', 'approved', 'rejected', 'paid');

-- ══════════════════════════════════════════════════════════════════
-- MULTITENANT
-- ══════════════════════════════════════════════════════════════════
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'standard',
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null unique,
  status event_status not null default 'draft',
  device_type device_kind not null default 'qr',
  brand_primary text not null default '#B5691A',
  brand_secondary text not null default '#187A5D',
  logo_url text,
  currency text not null default 'CRC',
  max_balance numeric(12, 2),
  refund_policy jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════
-- UBICACIONES Y USUARIOS
-- ══════════════════════════════════════════════════════════════════
create table branches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  type branch_kind not null default 'sales_point',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table terminals (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  device_label text not null,
  last_seen_at timestamptz,
  is_active boolean not null default true
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete set null,
  full_name text,
  phone text,
  role user_role not null default 'operator'
);

create table branch_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (user_id, branch_id)
);

-- ══════════════════════════════════════════════════════════════════
-- DISPOSITIVOS Y SALDOS
-- ══════════════════════════════════════════════════════════════════
create table attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  document_id text,
  created_at timestamptz not null default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  uid text not null,
  type device_kind not null,
  status device_status not null default 'unassigned',
  assigned_attendee_id uuid references attendees(id) on delete set null,
  assigned_at timestamptz,
  replaced_by uuid references devices(id) on delete set null,
  created_at timestamptz not null default now()
);

-- un UID nunca se reutiliza dentro del mismo evento
create unique index devices_event_uid_key on devices(event_id, uid);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references devices(id) on delete cascade,
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  version int not null default 0,
  updated_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════
-- TRANSACCIONES — ledger append-only, nunca se edita ni se borra
-- ══════════════════════════════════════════════════════════════════
create table transactions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  terminal_id uuid references terminals(id) on delete set null,
  device_id uuid not null references devices(id) on delete cascade,
  type transaction_type not null,
  amount numeric(12, 2) not null check (amount > 0),
  balance_before numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  attendant_id uuid references profiles(id) on delete set null,
  client_tx_id uuid, -- idempotencia (sección 10 del plan): un reintento de red no duplica el cobro
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index transactions_event_created_idx on transactions(event_id, created_at desc);
create index transactions_device_created_idx on transactions(device_id, created_at desc);
create index transactions_branch_created_idx on transactions(branch_id, created_at);
create unique index transactions_client_tx_id_key on transactions(client_tx_id) where client_tx_id is not null;

create table refund_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status refund_status not null default 'pending',
  requested_by uuid references profiles(id) on delete set null,
  processed_by uuid references profiles(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════
-- transactions es append-only: sin políticas de UPDATE/DELETE más abajo,
-- así que RLS las deniega por defecto para todos los roles.
-- ══════════════════════════════════════════════════════════════════
revoke update, delete on transactions from authenticated, anon;

-- ══════════════════════════════════════════════════════════════════
-- HELPERS DE ROL / EVENTO A PARTIR DE LOS CLAIMS DEL JWT
-- (custom_access_token_hook — sección 7 del plan: org_id, event_id, role)
-- ══════════════════════════════════════════════════════════════════
create or replace function auth_role() returns text
  language sql stable
  as $$ select nullif(auth.jwt() ->> 'event_role', '') $$;

create or replace function auth_event_id() returns uuid
  language sql stable
  as $$ select nullif(auth.jwt() ->> 'event_id', '')::uuid $$;

create or replace function auth_org_id() returns uuid
  language sql stable
  as $$ select nullif(auth.jwt() ->> 'org_id', '')::uuid $$;

create or replace function is_super_admin() returns boolean
  language sql stable
  as $$ select auth_role() = 'super_admin' $$;

-- ══════════════════════════════════════════════════════════════════
-- RLS — aislamiento por evento (base; se afina por Edge Function según
-- avancen los sprints 2-3)
-- ══════════════════════════════════════════════════════════════════
alter table organizations enable row level security;
alter table events enable row level security;
alter table branches enable row level security;
alter table terminals enable row level security;
alter table profiles enable row level security;
alter table branch_members enable row level security;
alter table attendees enable row level security;
alter table devices enable row level security;
alter table wallets enable row level security;
alter table transactions enable row level security;
alter table refund_requests enable row level security;

create policy super_admin_all_organizations on organizations
  for all using (is_super_admin()) with check (is_super_admin());

create policy super_admin_all_events on events
  for all using (is_super_admin()) with check (is_super_admin());
create policy event_scoped_read_events on events
  for select using (id = auth_event_id());

create policy super_admin_all_branches on branches
  for all using (is_super_admin()) with check (is_super_admin());
create policy event_scoped_branches on branches
  for select using (event_id = auth_event_id());

create policy super_admin_all_terminals on terminals
  for all using (is_super_admin());
create policy event_scoped_terminals on terminals
  for select using (
    branch_id in (select id from branches where event_id = auth_event_id())
  );

create policy self_profile on profiles
  for select using (id = auth.uid() or is_super_admin());

create policy super_admin_all_attendees on attendees
  for all using (is_super_admin()) with check (is_super_admin());
create policy event_scoped_attendees on attendees
  for select using (event_id = auth_event_id());

create policy super_admin_all_devices on devices
  for all using (is_super_admin()) with check (is_super_admin());
create policy event_scoped_devices on devices
  for select using (event_id = auth_event_id());

create policy super_admin_all_wallets on wallets
  for all using (is_super_admin());
create policy event_scoped_wallets on wallets
  for select using (
    device_id in (select id from devices where event_id = auth_event_id())
  );

create policy super_admin_all_transactions on transactions
  for select using (is_super_admin());
create policy event_scoped_transactions on transactions
  for select using (event_id = auth_event_id());
-- el insert real de transacciones ocurre solo vía Edge Function con
-- service_role (sección 5), por eso no hay policy de insert para
-- authenticated aquí.

create policy super_admin_all_refunds on refund_requests
  for all using (is_super_admin());
create policy event_scoped_refunds on refund_requests
  for select using (
    device_id in (select id from devices where event_id = auth_event_id())
  );
