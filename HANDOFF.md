# PrismaCash — Estado del proyecto y continuación

> Documento de traspaso. Última actualización: 2026-09-07.
> El plan completo del producto está en [`PLAN-IMPLEMENTACION.md`](./PLAN-IMPLEMENTACION.md)
> y su versión visual en [`PrismaCash-Plan.html`](./PrismaCash-Plan.html). Este archivo
> es el estado de la **implementación**, no del plan.

---

## 1. Cómo retomar esto en otra máquina

Este proyecto **no está en git todavía** — no hay repo remoto. Para moverlo a otro
equipo hoy, la única forma es copiar la carpeta completa (excluyendo `node_modules`
y `dist`, que se regeneran). **Recomendación fuerte:** antes de seguir, inicializar
un repo git y subirlo a un remoto (GitHub/GitLab privado) — sin eso, cualquier
traspaso futuro va a ser copiar carpetas a mano otra vez.

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
  y setea `replica identity full`. **ESTA MIGRACIÓN NO ESTÁ APLICADA TODAVÍA**
  (ver sección 3.) — el panel Staff no verá personal y el Realtime no funcionará
  hasta aplicarla en el SQL Editor.
- **Redirección post-login por rol**: `src/lib/sessionRole.ts` lee el rol del
  JWT (claims del auth hook) y `Login.tsx` manda a `/e/:slug/admin` para
  super_admin/event_admin, y a `/pos` o `/kiosk` para operator según los tipos
  de sucursal a las que está asignado.
- **Guardas de ruta**: `RequireAuth` en `src/App.tsx` redirige a `/login` si no
  hay sesión (espera a que la sesión termine de restaurarse antes de decidir).

---

## 3. Pendientes activos

- **No hay bloqueador SQL ni de cámara.** La migración `0011` (lectura de
  staff para event_admin + publicación Realtime de `transactions`) ya está
  aplicada en el proyecto real. La cámara en `/e/demo/kiosk` y `/e/demo/pos`
  funciona con mensajes de error visibles si algo falla.
- Lo que sigue son pruebas en vivo de los flujos (sección 5) — todo lo
  restante es implementación nueva, no fixes.

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

1. Probar el flujo completo real: `issue-device` desde el quiosco (crear
   dispositivo + recarga inicial) y luego `charge` desde el POS con ese mismo
   `device_uid`, confirmando que el saldo baja correctamente. También probar
   `block-and-replace` en el quiosco (bloquear + migrar saldo a un dispositivo
   nuevo).
2. Probar en vivo el Dashboard: entrar a `/e/demo/admin/dashboard` con el user
   `super_admin` y confirmar KPIs + gráfica + Realtime (la migración 0011 ya
   está aplicada, así que los INSERTs deben aparecer en vivo) y que Staff
   muestra el personal del evento.
3. CRUD de sucursales/staff/dispositivos para `event_admin` — hoy las vistas
   admin son de solo lectura por decisión de producto (solo `super_admin`
   edita). Retomar cuando se quiera que el admin del evento administre.
4. Inicializar git + repo remoto (ver sección 1).
5. Fase 2 del plan: app móvil Expo, recarga online (Stripe/Mercado
   Pago/institución bancaria — ya documentado en el plan), modo offline.

---

## 6. Estructura del repo

```
PLAN-IMPLEMENTACION.md     plan maestro completo (markdown)
PrismaCash-Plan.html       mismo plan, versión visual/interactiva
HANDOFF.md                 este archivo
supabase/
  migrations/0001-0011     correr en orden — 0010 topup, 0011 se aplica a mano en SQL Editor
  seed.sql                 datos de prueba (evento "demo")
  functions/                charge · issue-device · block-and-replace · topup · _shared/
src/
  lib/supabase.ts           cliente de Supabase
  lib/auth.tsx + auth-context.ts   sesión + hook useAuth()
  lib/sessionRole.ts         roles del JWT (claims del auth hook) + ruta por rol
  lib/functionError.ts       extrae el error de negocio de Edge Functions
  hooks/useEvent.ts          evento actual por slug (RLS-aware)
  components/DeviceScanner.tsx    NFC (Web NFC) / QR (cámara)
  pages/Login.tsx, Kiosk.tsx, Pos.tsx, admin/*
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
```

Nota: el proyecto real (`lhvqpymbgkjyfdcryhzp`) no está linkeado al CLI de esta
máquina (otra cuenta). Las migraciones que no sean reclamos de Edge Functions
se aplican pegando el SQL en el SQL Editor del dashboard.

Auth Hook (paso manual, no se puede hacer por SQL): Dashboard → Authentication
→ Hooks → "Customize Access Token (JWT) Claims" → Postgres Function →
`custom_access_token_hook`. **Ya está activado en el proyecto actual** — solo
hace falta repetirlo si se crea un proyecto Supabase nuevo desde cero.
