# PrismaCash

Pagos NFC/QR sin contacto para eventos (ferias, picnics). PWA en React + Vite +
Tailwind, backend en Supabase, hosting en Vercel.

El plan completo (arquitectura, modelo de datos, seguridad, roadmap) está en
[`PLAN-IMPLEMENTACION.md`](./PLAN-IMPLEMENTACION.md) y en la versión visual
interactiva [`PrismaCash-Plan.html`](./PrismaCash-Plan.html).

## Setup

```bash
npm install
cp .env.example .env   # completa VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Supabase

```bash
supabase link --project-ref <tu-proyecto>
supabase db push          # aplica supabase/migrations/*.sql en orden
supabase db execute -f supabase/seed.sql   # datos de prueba (evento "demo")
supabase functions deploy charge
supabase functions deploy issue-device
supabase functions deploy block-and-replace
```

Si aplicaste las migraciones a mano (SQL Editor del dashboard en vez del
CLI), corre los archivos de `supabase/migrations/` **en orden numérico**,
uno por uno — no se pueden pegar todos juntos si ya corriste una parte,
porque `0003` depende de que `0002` ya exista.

### Paso manual obligatorio: Auth Hook

`0004_event_admins_and_auth_hook.sql` crea la función
`custom_access_token_hook`, pero activarla **no se puede hacer por SQL**:

1. Dashboard → **Authentication → Hooks**.
2. "Customize Access Token (JWT) Claims" → Postgres Hook → selecciona
   `custom_access_token_hook`.

Sin este paso, `auth.jwt()` no trae `event_role`/`event_id`/`org_id`, y las
políticas RLS no dejan ver nada a nadie excepto su propio `profile`.

### Crear tu primer usuario de prueba

`supabase/seed.sql` crea la organización, el evento (`demo`, tipo `qr` para
poder probar con la cámara de la laptop) y una sucursal, pero **no** puede
crear el usuario de Auth (requiere el dashboard o `signUp`):

1. Dashboard → **Authentication → Users → Add user** (con email/contraseña).
2. Copia el `id` generado y corre:
   ```sql
   insert into profiles (id, org_id, full_name, role)
   values ('<uuid-del-usuario>', '00000000-0000-0000-0000-000000000001', 'Operador Demo', 'operator');

   insert into branch_members (user_id, branch_id)
   values ('<uuid-del-usuario>', '00000000-0000-0000-0000-000000000003');
   ```
3. Entra en `/login` con slug `demo` y esas credenciales, y luego a mano a
   `/e/demo/kiosk` o `/e/demo/pos` (la redirección automática por rol todavía
   no distingue operator — ver el TODO en `Login.tsx`).

Para un `super_admin`, usa `role = 'super_admin'` y no hace falta
`branch_members`.

## Qué hace cada pieza

- `supabase/migrations/0001_init.sql` — esquema completo (organizations, events,
  branches, devices, wallets, transactions, ...) y RLS inicial.
- `0002_charge_function.sql` / `0003_fix_charge_grants.sql` — función
  `charge()` con `pg_advisory_xact_lock` (cobro atómico, sección 5.2 del
  plan) y la corrección de permisos (ver nota de seguridad más abajo).
- `0004_event_admins_and_auth_hook.sql` — tabla `event_admins` + el hook que
  mete `event_role`/`event_id`/`org_id` en el JWT (sin esto, RLS no deja ver
  nada).
- `0005_issue_device_function.sql` — alta de dispositivo + recarga inicial
  (sección 5.1).
- `0006_block_and_replace_function.sql` — dispositivo extraviado: bloquea y
  migra el saldo al nuevo (sección 5.3). Todavía sin UI conectada.
- `supabase/functions/{charge,issue-device,block-and-replace}/` — Edge
  Functions que exponen esas tres funciones, cada una validando que el
  operador pertenezca a la sucursal antes de llamarlas.

**Nota de seguridad:** `0002` original tenía un hueco — revocar `EXECUTE` a
`authenticated`/`anon` no alcanza porque Postgres otorga ese privilegio a
`PUBLIC` por defecto al crear la función, y los roles lo heredan igual.
`0003` lo corrige revocando de `PUBLIC` explícitamente. `0005` y `0006` ya
nacieron con el grant correcto.

## Estructura

```
src/
  lib/supabase.ts          cliente de Supabase
  hooks/useEvent.ts         resuelve el evento actual por slug (RLS-aware)
  components/DeviceScanner.tsx  NFC (Web NFC) / QR (cámara) según el evento
  pages/
    Login.tsx
    Kiosk.tsx               modo quiosco — issue-device
    Pos.tsx                 modo punto de venta — charge
    admin/                  panel del evento (dashboard, sucursales, staff, ...)
```

## Pendiente (próximos sprints)

- UI de `block-and-replace` en el quiosco (la función y el edge function ya
  existen, falta la pantalla).
- Redirección post-login por rol real (hoy siempre manda a `/admin`).
- Dashboard realtime, CRUD de sucursales/staff/dispositivos (Sprint 3).
- App móvil Expo, recarga online, modo offline (Fase 2 — ver el plan).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm run preview` | Sirve el build de producción localmente |
