# Especificación — App Móvil de Asistente (PrismaCash Mobile)

Fecha: 2026-09-10
Proyecto: PrismaCash
Estado: Aprobado

## Resumen

App móvil nativa (Expo / React Native) para **asistentes** de eventos: reflejan su saldo y dispositivo, cobran con QR desde su teléfono, recargan online y solicitan reembolsos. Es la **Fase 2** del plan maestro (`PLAN-IMPLEMENTACION.md` sección 9). Se desarrolla en `mobile/` dentro del mismo monorepo PrismaCash.

## Contexto y decisiones cerradas

| Decisión | Elección |
|---|---|
| Framework | Expo (React Native), managed workflow |
| Login asistente | Email + contraseña (Supabase Auth) |
| Alta de cuenta | Self-service en la app + **QR de emparejamiento** del quiosco |
| Flujo en quiosco | Crea dispositivo `unassigned` + código de emparejamiento (sin datos de asistente) |
| Multi-evento | Uno a la vez: la app cambia de evento al escanear un QR nuevo |
| Pasarela de recarga | Stripe Checkout (web) vía `expo-web-browser.openAuthSession` — compatible con Expo Go |
| Notificaciones | Expo Push Notifications (proveedor Expo, sin Firebase) |
| Despliegue | EAS Build → TestFlight (iOS) + Play internal testing (Android) |

## Fuera de alcance

- App de operador/admin móvil (roles `operator`/`event_admin`/`super_admin` quedan en la PWA)
- NFC desde el teléfono del asistente (reservado Fase 3 del plan)
- Modo offline tolerante para terminales (es de la PWA, Fase 2 del plan, no de la app de asistente)
- QR rotativo anti-fotografía (riesgo documentado en el plan; mitigación futura)
- Múltiples pasarelas de pago (solo Stripe por ahora)

## Arquitectura

```
mobile/
  app.json                          # Config Expo (EAS, push permissions)
  app/                              # expo-router (file-based routing)
    index.tsx                       # Redirige a /login o /(tabs)
    login.tsx
    register.tsx
    pair.tsx                        # Deep link + escaneo QR de emparejamiento
    (tabs)/
      _layout.tsx                   # TabBar: Mi QR | Historial | Recargar | Reembolso | Ajustes
      qr.tsx
      history.tsx
      topup.tsx
      refund.tsx
      settings.tsx
  src/
    lib/supabase.ts                 # @supabase/supabase-js (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY)
    lib/auth.tsx                    # AuthProvider (email+password, onAuthStateChange)
    lib/api.ts                      # Wrappers invoke de Edge Functions + functionError (espejo de src/lib de la web)
    context/EventContext.tsx        # Evento activo (uno a la vez, persistido en AsyncStorage)
    hooks/useDevice.ts, useBalance.ts, useHistory.ts, useTopup.ts, useRefund.ts
```

- **Navegación:** expo-router (estándar de Expo), tabs para las pantallas principales.
- **Estado:** `@tanstack/react-query` (mismo patrón que la web) + `AsyncStorage` para el evento activo.
- **Clientes:** `@supabase/supabase-js` (mismo modelo de datos y Edge Functions que la web). No hay código compartido con `src/` de la PWA (bundlers distintos), pero se duplican solo los wrappers finos.
- **Scanning QR:** `expo-camera` (emparejamiento). La lectura/cobro en POS sigue siendo de la PWA.

## Backend / modelo de datos

### Migración `0014_attendee_flow.sql`

```sql
-- 1) Rol attendee
alter type user_role add value 'attendee';

-- 2) attendees → cuenta de auth (null hasta emparejar)
alter table attendees add column user_id uuid references auth.users(id) on delete set null;

-- 3) devices → código de emparejamiento de un solo uso (para el QR impreso)
alter table devices add column pairing_code uuid unique,
                   add column pairing_code_expires_at timestamptz,
                   add column paired_at timestamptz;

-- 4) Recargas online
create table payment_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  device_id uuid not null references devices(id),
  event_id uuid not null references events(id),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  stripe_checkout_id text unique,
  tx_id uuid references transactions(id),
  error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- 5) RLS para asistente
--   - attendees: SELECT/UPDATE where user_id = auth.uid()
--   - devices:    SELECT donde assigned_attendee_id ∈ sus attendees
--   - wallets:    SELECT vía su device
--   - transactions: SELECT vía su device
--   - payment_requests: SELECT/INSERT propias (device suyo); UPDATE solo status por Edge Function
--   - refund_requests:  SELECT/INSERT propias (device suyo)
```

Cambio al enum `user_role` (0001, línea 10) — cuidado con el auth hook `custom_access_token_hook` que lee `profiles.role`; un `attendee` sin evento asignado obtiene claims de rol sin evento, y el JWT no vincula un `event_id` (la app resuelve el evento por emparejamiento, no por claim).

### Edge Functions

**Modificada:**
- `issue-device`: al crear el dispositivo ya no requiere datos de asistente. Genera `pairing_code` (uuid) + `pairing_code_expires_at = now() + interval '48 hours'`, devuelve `{ device_uid, pairing_code }`. El quiosco imprime un QR que codifica un deep link `prismacash://pair?code=<pairing_code>`. Dispositivo queda `unassigned`. (`attendee_name/phone` siguen siendo opcionales y compatibles para el flujo híbrido futuro.)

**Nuevas:**
- `pair-device` — Input: `pairing_code`. Validación: código existe, no expiró, dispositivo `unassigned`. Crea `attendees` (user_id = auth.uid()) o reutiliza el existente del dispositivo, setea `devices.assigned_attendee_id`, `paired_at`, `status='active'`, invalida el pairing_code (`pairing_code = null`). Devuelve `{ device_uid, device_type, event: { id, name } }`. Errores: `not_found` | `expired` | `already_paired`.
- `create-topup` — Input: `device_id`, `amount`. Requiere asistente autenticado (rol `attendee`) dueño del device. Crea `payment_requests` (pending) + Checkout Session de Stripe con `metadata = { payment_request_id, event_id, profile_id }`, `success_url`/`cancel_url` → devuelve `{ session_url }`.
- `stripe-webhook` — Recibe `checkout.session.completed`. Verifica firma (Stripe secret). Encuentra `payment_requests` por `stripe_checkout_id`, marca `succeeded` (idempotente: si ya está `succeeded`, no duplicar) y ejecuta `topup` (misma RPC que usa la PWA) registrando el `tx_id`. Dispara notificación push de "recarga confirmada".
- `process-refund` — Admin (`event_admin`/`super_admin`): cambia `refund_requests.status` de `pending` → `approved` | `rejected`. Si `approved`: debita saldo del dispositivo (registro `refund` en `transactions`, inverso de `charge`), marca `processed_by/processed_at` y notifica al asistente por push.

## Flujo funcional de la app

1. **Registro / Login** → email + password (Supabase Auth). Al registrarse se crea `profile` con `role='attendee'`. Se pide consentimiento de notificaciones y se guarda el `push_token`.
2. **Emparejamiento** → sin dispositivo aún: pantalla "Escanea el QR de tu pulsera/llavero". Escanea el QR impreso del quiosco (deep link `prismacash://pair?code=...`) → `pair-device` → evento activo guardado en AsyncStorage. Si el usuario ya tenía un evento y escanea otro QR de otro evento, la app cambia al nuevo evento.
3. **TabBar (evento activo):**
   - **Mi QR** — QR grande codificando el `device_uid` (el mismo contenido del QR impreso, así el POS lo cobra igual). Muestra saldo actual, nombre del evento, dispositivo activo. Brillo máximo mientras se muestra.
   - **Historial** — lista de `transactions` del dispositivo con filtros por tipo (`payment`, `topup`, `initial_load`, `refund`).
   - **Recargar** — montos rápidos + editable. Llama `create-topup`, abre `session_url` con `expo-web-browser.openAuthSessionAsync`, y al volver refresca el saldo (el estado definitivo llega por webhook → `topup` → Realtime/polling). Muestra estados `pending/succeeded/failed`.
   - **Reembolso** — formulario (importe ≤ saldo) → `INSERT` en `refund_requests` (status `pending`). La pantalla muestra el estado de la solicitud.
   - **Ajustes** — evento activo actual, cambiar evento (reescanear QR), notificaciones, cerrar sesión.

## Notificaciones push

- Tabla `profiles`: columna `push_token` (nullable). Se guarda tras el consentimiento en el primer login/registro.
- Edge Function `notify` interna (invocada solo por `stripe-webhook` y `process-refund` tras confirmar) que llama a Expo Push API `POST https://exp.host/--/api/v2/push/send` con `{ to, title, body, data }`.
- Mensajes: "Recarga confirmada: ₡5.000" / "Tu reembolso fue aprobado".

## Seguridad

- El QR del quiosco codifica el `pairing_code` (uuid de un solo uso, TTL 48h) —**no** el `device_uid`— para que una foto del QR impreso no permita robar el dispositivo. El QR mostrado en "Mi QR" sí codifica el `device_uid` (mismo contrato que el POS).
- RLS garantiza que un `attendee` solo vea dispositivos/transacciones/saldo de sus propios devices (vía `attendees.user_id`).
- `stripe-webhook` verifica firma `Stripe-Signature`.
- `create-topup`/`pair-device` validan autenticación y propiedad del dispositivo antes de operar.

## Testing y despliegue

- **Unit/component:** jest + @testing-library/react-native (mock de supabase y de Edge Functions) — login, emparejamiento, historial, topup (estados), refund.
- **Verificación CI/local:** `npm run build` + `npm run lint` (maestra) y en `mobile/` `tsc --noEmit` + `expo export` (verifica bundling). No se transpilan Edge Functions localmente (igual que hoy).
- **E2E manual:** prueba con un usuario real y un dispositivo emparejado en el evento `demo`.
- **Despliegue:** EAS Build (cloud) configurado en `app.json`; TestFlight para iOS y Play internal testing para Android. Las variables `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` viajan en el bundle (mismas de la web).

## Dependencias nuevas (solo en `mobile/`)

`expo`, `expo-router`, `expo-camera` (API moderna `CameraView`/`onBarcodeScanned`), `expo-web-browser`, `expo-notifications`, `expo-screen-brightness` (brillo máximo), `@react-native-async-storage/async-storage`, `@supabase/supabase-js`, `@tanstack/react-query`, `react-native-qrcode-svg` (generar QR).

## Entregables

1. Migración `0014_attendee_flow.sql`.
2. Edge Functions: `pair-device`, `create-topup`, `stripe-webhook`, `process-refund`; modificación de `issue-device`.
3. Cambio de la PWA: quiosco imprime QR de emparejamiento (deep link) en el alta; pantalla admin `Refunds` añade aprobar/rechazar (usa `process-refund`).
4. App `mobile/` completa (login, registro, emparejamiento, Mi QR, historial, recarga Stripe, reembolso, ajustes).
5. Documentación de despliegue en EAS + TestFlight/Play.

## Orden sugerido de implementación

1. Migración + Edge Functions backend.
2. Cambios PWA (quiosco QR + Refunds aprobar/rechazar).
3. Scaffold de `mobile/` + login + emparejamiento.
4. Mi QR + historial.
5. Recarga Stripe + webhook.
6. Reembolso (app + admin).
7. Push notifications + pulido + EAS config.