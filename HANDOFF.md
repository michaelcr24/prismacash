# PrismaCash — Estado del proyecto y continuación

> Documento de traspaso. Última actualización: 2026-09-11.
> El plan completo del producto está en [`PLAN-IMPLEMENTACION.md`](./PLAN-IMPLEMENTACION.md)
> y su versión visual en [`PrismaCash-Plan.html`](./PrismaCash-Plan.html). Este archivo
> es el estado de la **implementación**, no del plan.

---

## 1. Cómo retomar esto en otra máquina

El proyecto está en git con remoto en GitHub (privado):
`https://github.com/michaelcr24/prismacash.git` — rama `main`, ya con todas las
migraciones y la feature de navegación superadmin pusheadas (2026-09-07).

Pasos para levantarlo en la máquina nueva:

```bash
npm install
cp .env.example .env   # completar con los valores de abajo (sección 3)
npm run dev
```

El `.env` **no se copia solo** (está en `.gitignore` y nunca se compartió por chat
por seguridad) — hay que volver a escribirlo a mano con las credenciales reales del
proyecto Supabase (pídeselas a quien tenga acceso al dashboard, o sácalas de
Project Settings → API).

---

## 2. Qué existe y funciona ahora mismo

### Backend (Supabase) — verificado end-to-end

- **Esquema completo** aplicado: `organizations`, `events`, `branches`, `terminals`,
  `profiles`, `branch_members`, `event_admins`, `attendees`, `devices`, `wallets`,
  `transactions` (append-only), `refund_requests`. RLS activo en todas.
- **Tres funciones transaccionales atómicas** en Postgres, todas con
  `pg_advisory_xact_lock` o lock de fila donde aplica, todas `SECURITY DEFINER`,
  todas con permisos correctamente restringidos a `service_role` (ver sección 4,
  ahí se explica un bug real de permisos que costó encontrar):
  - `charge()` — cobro en punto de venta.
  - `issue_device()` — alta de dispositivo + recarga inicial en el quiosco.
  - `block_and_replace()` — dispositivo extraviado, bloqueo + migración de saldo.
- **Auth Hook activo** (`custom_access_token_hook`) — mete `event_role` / `org_id`
  / `event_id` en el JWT según el `profiles.role` del usuario (y su
  `event_admins`/`branch_members` si aplica). **Confirmado funcionando end-to-end**
  con un usuario real: login → JWT con claims correctos → RLS filtra por evento
  correctamente → `useEvent()` en el frontend carga el evento real (`FERIA DEMO`
  cargó bien en `/e/demo/kiosk`).
- **Seed de datos de prueba** corrido (`supabase/seed.sql`): organización
  `demo-org`, evento `demo` (tipo `qr`, para probar con cámara sin hardware NFC),
  sucursal `Sucursal de prueba` (tipo `both`).
- **Usuario de prueba creado** con rol `super_admin`, login funcionando
  (`michaelcr24@gmail.com` — la contraseña la tiene quien lo creó, no está en
  ningún archivo del repo).

### Frontend — parcialmente verificado

- Scaffold Vite + React 19 + TS + Tailwind v4 + `vite-plugin-pwa`, con
  code-splitting por ruta (el bundle inicial bajó de 856KB a ~257KB moviendo
  `html5-qrcode` a un chunk separado que solo carga en quiosco/POS).
- `AuthProvider` (`src/lib/auth.tsx` + `auth-context.ts`) que espera a que
  `supabase.auth.getSession()` resuelva antes de habilitar queries — esto era
  necesario porque en una carga de página completa (URL directa a `/kiosk` o
  `/pos`) las queries salían antes de que la sesión terminara de restaurarse.
- `useEvent(eventSlug)` — resuelve el evento actual por slug, respetando RLS.
  **Verificado funcionando** (ver arriba).
- Login real contra Supabase Auth — **verificado funcionando**.
- Dashboard admin (`/e/:slug/admin/dashboard`) — carga y muestra el layout con
  branding del evento. **Verificado.** El contenido real (KPIs, Realtime) es
  placeholder todavía (Sprint 3, ver sección 5).
- Quiosco (`/e/:slug/kiosk`) y Punto de venta (`/e/:slug/pos`) — el formulario
  carga bien (ya no hay pantalla en blanco, ya no hay 406).

### Actualizaciones Sprint 3 (2026-09-07)

- **Dashboard realtime implementado** (`src/pages/admin/Dashboard.tsx`): KPIs
  (ventas de hoy, transacciones hoy, TX/min, dispositivos activos), gráfica de
  ingresos por hora (Recharts), feed de actividad reciente. Se suscribe a
  `postgres_changes` sobre `transactions` (INSERT filtrado por `event_id`) y
  usa polling cada 30s como respaldo.
- **Paneles admin de solo lectura implementados** (decisión: solo `super_admin`
  edita por ahora): `Branches` (sucursales + terminales), `Staff`
  (event_admins + operadores con sucursal), `Devices` (inventario con saldo),
  `Transactions` (filtro por tipo + export CSV), `Refunds` (cola de solicitudes).
- **Migración `0011_admin_read_and_realtime.sql`**: agrega políticas RLS de
  SELECT para que `event_admin` lea `profiles`/`branch_members`/`event_admins`
  de su propio evento, activa `transactions` en la publicación `supabase_realtime`
  y setea `replica identity full`. **Aplicada en el proyecto real** (SQL Editor),
  así que Staff ve el personal y el Realtime está activo en producción.
- **Redirección post-login por rol**: `src/lib/sessionRole.ts` lee el rol del
  JWT (claims del auth hook) y `Login.tsx` manda a `/e/:slug/admin` para
  super_admin/event_admin, y a `/pos` o `/kiosk` para operator según los tipos
  de sucursal a las que está asignado.
- **Guardas de ruta**: `RequireAuth` en `src/App.tsx` redirige a `/login` si no
  hay sesión (espera a que la sesión termine de restaurarse antes de decidir).

### Sprint 3.5 (2026-09-07) — Navegación superadmin entre pantallas

- **Hook `useSessionRole()`** (`src/hooks/useSessionRole.ts`): lee el rol del JWT
  desde `useAuth().session` + `readClaims()`. Única fuente de "¿es superadmin?" en
  las tres pantallas.
- **Sidebar admin** (`AdminLayout.tsx`): sección "Pantallas operativas" con
  enlaces a Kiosk (`/e/{slug}/kiosk`) y POS (`/e/{slug}/pos`), visible solo si
  `role === 'super_admin'`.
- **Vuelta al dashboard**: link "← Dashboard" en el topbar de `Kiosk.tsx` y
  `Pos.tsx`, visible solo para superadmin.
- **Staff editable (solo superadmin)** (`Staff.tsx`): formulario "Asociar persona
  a sucursal" (insert en `branch_members`) + botón "Quitar" (delete por
  `branch_members.id`). Invalidación de queries react-query
  (`admin-staff-members`, `admin-staff-operators`). `event_admin` conserva la
  vista de solo lectura.
- **Migración `0012_super_admin_branch_members.sql`**: política RLS
  `for all using (is_super_admin()) with check (is_super_admin())` sobre
  `branch_members` (antes solo SELECT). **Aplicada en el proyecto real**
  (SQL Editor).
- Hallazgo clave: las Edge Functions `charge`/`topup` solo validan membresía de
  sucursal si el cliente envía `branch_id`, y ni POS ni Kiosk lo envían → el
  superadmin puede operar POS/Kiosk de verdad sin ser `branch_member`.
- Los 6 commits (feature) están en `main` y pusheados; el worktree está limpio.

### Sprint 4 (2026-09-08) — Gestión de usuarios (UI de Staff)

- Spec: `docs/superpowers/specs/2026-09-08-user-management-design.md`; plan (14 tareas): `docs/superpowers/plans/2026-09-08-user-management.md`.
- CRUD completo de usuarios **solo para `super_admin`**; `event_admin` solo lectura.
- 4 Edge Functions nuevas (service role): `create-user` (alta manual, contraseña auto-generada que se muestra 1 vez), `invite-user` (invitación por email con rol), `update-user` (email/rol/contraseña; flujo atómico de 2 pasos: `409 {ok:false, error:'confirm_assignment_loss', assignments:[...]}` → el frontend reenvía con `confirm_loss:true`), `delete-user` (hard delete desde `auth.users` con cascada).
- Guardas: nunca crear/editar/borrar `super_admin` desde la UI (403 `cannot_edit_super_admin` / `cannot_delete_super_admin`).
- Migración `0013_staff_users_view.sql`: vista `staff_users` (id, org_id, email de auth.users, full_name, phone, role) con `security_invoker` y RLS.
- Frontend: `src/pages/admin/staff/api.ts` (wrappers de invoke), `Modal.tsx`, `ConfirmDialog.tsx`, `CreateUserModal.tsx`, `InviteUserModal.tsx`, `EditUserModal.tsx`, `UserTable.tsx`, reescritura de `Staff.tsx` (tabs Todos/Admins/Operadores + búsqueda).
- Rol solo `event_admin` / `operator`. Recuerda: **el JWT no refleja el rol nuevo hasta re-login** (consecuencia del diseño single-event-per-account de `0004`).

### Sprint 4.5 (2026-09-10) — Admin CRUD: sucursales + dispositivos

- Spec: `docs/superpowers/specs/2026-09-10-admin-crud-design.md`; plan (8 tareas): `docs/superpowers/plans/2026-09-10-admin-crud.md`.
- Login: `super_admin` ahora cae en `/admin` (antes caía a `/kiosk`); guard de rol en `AdminLayout`.
- CRUD directo vía `supabase.from()` con RLS (sin Edge Functions nuevas): `CreateBranchModal`, `EditBranchModal`, `ConfirmDeleteDialog`, `Branches.tsx` (con expandir terminales), `CreateDeviceModal` (crea device + wallet saldo 0), `EditDeviceModal`, `DeviceDetailModal` (feed últimas 10 txs), `Devices.tsx` (filtro por estado).
- **Lección clave de embeds PostgREST** (validada contra la DB live): los embeds de FK usan el nombre de la **tabla referenciada en plural** — `profiles`, `branches`, `devices`, `wallets`, `attendees`, `terminals` — **NO** `profile`/`user`/`branch`/`device`/`wallet`/`attendee` (dan 400 PGRST200). La tabla de reembolsos es `refund_requests` (no `refunds`).

### Sprint 4.10 (2026-09-11) — Admin CRUD: eventos

- **Spec/Plan**: `docs/superpowers/specs/2026-09-11-events-management-design.md` y `docs/superpowers/plans/2026-09-11-events-management.md`.
- Super_admin ahora tiene CRUD completo de eventos desde `/e/:eventSlug/admin/events` (nav item visible solo para `super_admin`).
- Página global: lista todos los eventos con organización, estado, dispositivo, moneda y fechas (`Events.tsx`, query `admin-all-events`).
- Modal de creación (`events/CreateEventModal.tsx`) con selector de organización (requerido), nombre, slug auto-generado (se congela tras tocar el campo), estado, tipo dispositivo, moneda, colores de marca.
- Modal de edición (`events/EditEventModal.tsx`) con los mismos campos pre-cargados. Manejo de error `23505` (slug duplicado).
- Diálogo de eliminación (`events/ConfirmDeleteEventDialog.tsx`) con advertencia de cascada (branches/devices/wallets/transactions se borran en cascada) vía `ConfirmDialog` (`message`/`items`/`danger`/`busy`).
- Acción "Abrir" navega a `/e/{slug}/admin/dashboard` para entrar al admin de ese evento.
- **Ojo con el embed `organizations!inner(name)`**: los tipos de Supabase lo modelan como array mientras PostgREST devuelve objeto en runtime (FK to-one); `Events.tsx` maneja ambas cardinalidades (`orgName()` helper) para no romper en ninguno de los dos casos.
- Patrón: `supabase.from()` directo con RLS (`super_admin_all_events`), sin Edge Functions nuevas.

---

## 3. Pendientes activos

- **Smoke test `update-user`** (curl con token de `super_admin`): esperar
  `409 {ok:false, error:'confirm_assignment_loss', assignments:[...]}` si el
  usuario operator tiene sucursales asignadas, o `200 {ok:true}` si no pierde
  nada. Requiere un usuario real con rol `operator` + `branch_members`.
- **E2E manual super_admin** en browser: login → `/admin`; `/e/demo/admin/branches`
  crear/editar/eliminar/expandir terminales; `/e/demo/admin/devices`
  crear/editar/eliminar/filtro/detalle; `/e/demo/admin/staff`
  crear/invitar/editar/eliminar (sin regresión). De paso probar
  `/transactions`, `/dashboard`, `/refunds` (estos tenían el bug de embeds,
  ya corregido). **Probar con login fresco**: el JWT no refleja el rol nuevo
  hasta volver a entrar.
- **E2E manual `event_admin`**: confirmar que Staff carga de solo lectura sin
  botones de gestión.
- **E2E manual eventos (super_admin)**: `/e/demo/admin/events` → crear evento
  (probar slug duplicado → muestra error), editar, eliminar (ver advertencia de
  cascada); confirmar que `event_admin` NO ve el nav item "Eventos" y que
  accediendo directo a la URL solo ve eventos de su org (RLS), no los de otras.
  Confirmar también en browser que la columna "Organización" muestra el nombre
  (no `—`) — valida el embed `organizations!inner(name)` en runtime.
- Las migraciones `0011`, `0012`, `0013` están aplicadas en el proyecto real;
  las 4 Edge Functions de gestión de usuarios (`create-user`, `invite-user`,
  `update-user`, `delete-user`) están desplegadas en el Dashboard.
- La cámara en `/e/demo/kiosk` y `/e/demo/pos` funciona con mensajes de error
  visibles si algo falla.

---

## 4. Bugs reales encontrados durante la implementación (contexto para no repetirlos)

Estos ya están corregidos en las migraciones, pero vale la pena que quien
continúe entienda por qué existen ciertas líneas "raras" en el SQL:

1. **`REVOKE ... FROM authenticated, anon` no alcanza para bloquear una
   función.** Postgres otorga `EXECUTE` a `PUBLIC` por defecto al crear una
   función, y los roles heredan ese grant de `PUBLIC` aunque se les revoque el
   privilegio a ellos directamente. Hay que revocar de `PUBLIC` explícitamente.
   Esto dejó `charge()` invocable por cualquier cliente anónimo hasta que se
   corrigió en `0003_fix_charge_grants.sql`. `issue_device()` y
   `block_and_replace()` ya nacieron con el grant correcto.

2. **Una función sin `set search_path = public` falla en un rol con
   `search_path` distinto.** `custom_access_token_hook` no encontraba el tipo
   `user_role` porque `supabase_auth_admin` abre una conexión nueva con un
   `search_path` que no incluye `public`. Corregido en
   `0007_fix_auth_hook_search_path.sql`.

3. **`GRANT SELECT` no basta si la tabla tiene RLS.** Son capas independientes:
   sin una política que aplique explícitamente a un rol, RLS filtra todas las
   filas aunque el rol tenga el privilegio de tabla. Esto hacía que
   `custom_access_token_hook` nunca encontrara el `profile` del usuario durante
   un login real (aunque probarlo a mano con `set role supabase_auth_admin`
   sí funcionaba — ver la nota abajo sobre por qué esa prueba manual engañaba).
   Corregido en `0009_auth_admin_rls_bypass.sql` con políticas explícitas
   `for select to supabase_auth_admin using (true)` en `profiles`,
   `event_admins`, `branch_members`, `branches`.

   *Por qué la prueba manual no lo detectaba:* `set role` dentro de una sesión
   ya abierta del SQL Editor no reproduce exactamente una conexión nueva real
   de `supabase_auth_admin`. El diagnóstico real solo se confirmó agregando
   `raise log` temporal dentro de la función (`0008_debug_auth_hook_temp.sql`,
   ya superado por `0009`) y leyendo Postgres Logs después de un login real.
   **Lección:** cuando algo funciona "a mano" pero falla en producción con un
   rol interno de Supabase, no confíes en la reproducción manual — instrumenta
   con `raise log` y lee los logs del intento real.

4. **`create-vite ... --overwrite` borra TODO el contenido previo del
   directorio**, no solo los archivos que chocan con el template. Así se perdió
   accidentalmente `PLAN-IMPLEMENTACION.md`, `PrismaCash-Plan.html` y una
   carpeta `.claude/` que ya existía ahí (esta última no se pudo recuperar, no
   había copia de su contenido). Los dos primeros se reconstruyeron desde el
   historial de la conversación. **Lección:** nunca correr `--overwrite` /
   `--force` en un directorio no vacío sin revisar antes qué hay dentro.

---

## 5. Pendiente (en orden de prioridad)

1. **Smoke test + E2E manual** (ver sección 3): curl `update-user` + pruebas
   de browser para super_admin y event_admin.
2. Pruebas en vivo de los flujos transaccionales del Sprint 3: flujo real
   quiosco→POS (`issue-device`, `charge`, `block-and-replace`) y Dashboard
   live (KPIs + Realtime).
3. **App móvil nativa (pendiente)** — Fase 2 del plan: app Expo, recarga
   online (Stripe — documentado en spec/plan de 2026-09-10), modo offline.
   En pausa por decisión de producto; spec y plan de 16 tareas commiteados
   en `main`.

---

## 6. Estructura del repo

```
PLAN-IMPLEMENTACION.md     plan maestro completo (markdown)
PrismaCash-Plan.html       mismo plan, versión visual/interactiva
HANDOFF.md                 este archivo
docs/superpowers/           specs/ y plans/ de cada feature (workflow superpowers)
supabase/
  migrations/0001-0013     correr en orden — 0013 (vista staff_users) aplicada en el proyecto real
  seed.sql                 datos de prueba (evento "demo")
  functions/                charge · topup · issue-device · block-and-replace ·
                            create-user · invite-user · update-user · delete-user · _shared/{admin,cors,users}.ts
src/
  lib/supabase.ts           cliente de Supabase
  lib/auth.tsx + auth-context.ts   sesión + hook useAuth()
  lib/sessionRole.ts         roles del JWT (claims del auth hook) + ruta por rol
  lib/functionError.ts       extrae el error de negocio de Edge Functions
  hooks/useEvent.ts          evento actual por slug (RLS-aware)
  hooks/useSessionRole.ts    rol de sesión (super_admin/event_admin/operator) — navegación superadmin
  components/DeviceScanner.tsx    NFC (Web NFC) / QR (cámara)
  pages/Login.tsx, Kiosk.tsx, Pos.tsx, admin/*   (AdminLayout, Dashboard, Branches,
                            Devices, Staff, Transactions, Refunds + modales en branches/, devices/, staff/)
```
```

## 7. Comandos útiles

```bash
npm run dev / build / lint / preview
supabase link --project-ref <ref>
supabase db push                         # aplica las migraciones pendientes
supabase db execute -f supabase/seed.sql
supabase functions deploy charge
supabase functions deploy issue-device
supabase functions deploy block-and-replace
supabase functions deploy topup
supabase functions deploy create-user
supabase functions deploy invite-user
supabase functions deploy update-user
supabase functions deploy delete-user
```

Nota: el proyecto real (`lhvqpymbgkjyfdcryhzp`) no está linkeado al CLI de esta
máquina (otra cuenta). Las migraciones se aplican pegando el SQL en el SQL Editor
del dashboard; las Edge Functions se despliegan desde el Dashboard subiendo la
carpeta `supabase/functions/` completa (incluye `_shared/`).

Auth Hook (paso manual, no se puede hacer por SQL): Dashboard → Authentication
→ Hooks → "Customize Access Token (JWT) Claims" → Postgres Function →
`custom_access_token_hook`. **Ya está activado en el proyecto actual** — solo
hace falta repetirlo si se crea un proyecto Supabase nuevo desde cero.
