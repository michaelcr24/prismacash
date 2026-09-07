# 🎪 Plan de Implementación — Sistema de Pagos Contactless para Eventos

> **Nombre provisional del producto:** *PrismaCash* (pagos NFC/QR para ferias, picnics y eventos)
> **Stack principal:** React + Vite + Tailwind CSS + Supabase + Vercel + PWA
> **Complemento móvil:** React Native (Expo) — Android/iOS
> **Versión del documento:** 1.0 — 2026-09-04

---

## 1. Resumen ejecutivo

Sistema SaaS multi-evento que permite a los organizadores vender dispositivos de pago sin contacto (pulseras NFC, llaveros NFC o códigos QR) a los asistentes, recargar saldo en quioscos/terminales y cobrar en puntos de venta escaneando el dispositivo. Todo en tiempo real, con dashboard de seguimiento, gestión de roles (admin global → admin de evento → operador de terminal) y una app móvil para que el asistente autogestione su saldo e historial.

**Flujo core en 3 pasos:**
1. **Recarga** → El asistente compra un dispositivo en el quiosco; el operador lo registra, activa y recarga con monto X.
2. **Pago** → El vendedor escanea el dispositivo (NFC o QR según configuración del evento), se verifica activo + saldo, se descuenta y se registra la transacción.
3. **Reembolso / bloqueo** → El asistente puede solicitar reembolso del saldo desde la app móvil; si extravía el dispositivo, el operador lo inactiva y le asigna uno nuevo migrando el saldo.

**Decisiones de producto cerradas:**
- **Multi-tenancy:** un único proyecto Supabase compartido entre todos los eventos/clientes que alquilen el servicio, aislado lógicamente por `event_id` vía RLS (no un proyecto por cliente). Menor costo operativo y un solo panel para administrar todos los eventos.
- **Naturaleza del saldo:** crédito cerrado de uso interno del evento, no dinero electrónico transferible (ver sección 6, "Encuadre legal del saldo").
- **App móvil nativa:** Fase 2, posterior a validar el MVP web en un evento real.
- **Cronograma:** guía flexible de secuencia de trabajo, sin fecha de evento piloto comprometida (ver sección 12).

---

## 2. Alcance funcional (MVP → Fases)

### 2.1 Fase 1 — MVP (núcleo operativo)

- Registro y configuración de eventos (solo admin global): nombre, paleta de colores, logos, tipo de dispositivo (NFC o QR).
- Gestión de sucursales/terminales (quiosco de recarga + N puntos de venta).
- Usuarios y roles: `super_admin`, `event_admin`, `operator` (asignado a una sucursal/terminal).
- Registro de asistente + asignación de dispositivo (ID único) + recarga inicial.
- Cobro: escaneo (NFC o QR según evento) → verificación → débito → registro de transacción.
- Bloqueo de dispositivo extraviado + reasignación con migración de saldo.
- Dashboard en tiempo real del admin de evento (ventas, transacciones, saldo circulante, terminales activas).
- Historial de transacciones (id, fecha/hora, sucursal, monto, tipo).

### 2.2 Fase 2 — Complementos

- App móvil (Expo): autogestión de recargas (si se permite), historial, solicitud de reembolso.
- Reportes exportables (CSV/Excel/PDF).
- Top-ups online con pasarela de pago (Stripe, Mercado Pago o conexión directa con institución bancaria — ej. SINPE Móvil / transferencia con conciliación automática) desde la app.
- Modo offline tolerante para terminales de venta (cola local + sincronización).

### 2.3 Fase 3 — Escala

- Multi-evento simultáneos con aislamiento total de datos.
- Analytics avanzado (heatmaps de consumo por hora/terminal/producto).
- API pública / webhooks para integraciones externas.
- Kioscos con modo pantalla completa bloqueada (kiosk mode).

---

## 3. Arquitectura general

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENTES                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │  PWA (Vite+   │  │  PWA Terminal │  │  App Móvil (Expo)    │  │
│  │  React) Admin │  │  / Quiosco    │  │  Asistente           │  │
│  │  + Dashboard  │  │  (Tablet)     │  │  Android / iOS       │  │
│  └──────┬────────┘  └──────┬────────┘  └──────────┬───────────┘  │
│         │  HTTPS / WSS     │  HTTPS / WSS         │  HTTPS       │
├─────────┴──────────────────┴──────────────────────┴──────────────┤
│                       SUPABASE (Backend-as-a-Service)             │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ PostgreSQL │  │  Auth      │  │  Realtime    │  │  Storage  │ │
│  │ (RLS)      │  │  (JWT)     │  │  (Postgres   │  │  (logos,  │ │
│  │            │  │            │  │  Changes)    │  │  avatares)│ │
│  └────────────┘  └────────────┘  └──────────────┘  └───────────┘ │
│  ┌────────────┐  ┌────────────────────────────────────────────┐  │
│  │ Edge       │  │  Deno Functions: pagos atómicos,           │  │
│  │ Functions  │  │  reembolsos, migración de saldo, webhooks  │  │
│  └────────────┘  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
         ▲
         │  Despliegue continuo
┌────────┴─────────┐
│     VERCEL       │  ← Hosting PWA (preview + producción, dominios por evento)
└──────────────────┘
```

**Decisión clave: Supabase como backend completo.** Proporciona PostgreSQL con Row Level Security (multitenant seguro), autenticación con JWT, suscripciones Realtime (dashboard en vivo), Storage (logos) y Edge Functions (lógica transaccional atómica) sin servidor propio. Vercel hospeda el frontend con despliegue continuo desde Git.

---

## 4. Modelo de datos (PostgreSQL / Supabase)

```sql
-- ══════════ MULTITENANT ══════════
organizations      -- tenant raíz (tu empresa, arrienda el servicio)
  id, name, slug, plan, created_at

events             -- cada feria/picnic/evento
  id, org_id → organizations, name, slug, status (draft|active|closed),
  device_type (nfc|qr|hybrid), brand_primary, brand_secondary, logo_url,
  currency, max_balance, refund_policy (jsonb), starts_at, ends_at, created_at

-- ══════════ UBICACIONES Y USUARIOS ══════════
branches           -- "sucursales": quiosco de recarga, chinamos, puntos de venta
  id, event_id → events, name, type (recharge_kiosk|sales_point|both),
  is_active, created_at

terminals          -- dispositivo físico dentro de una sucursal
  id, branch_id → branches, device_label, last_seen_at, is_active

profiles           -- extiende auth.users
  id → auth.users, org_id, full_name, phone, role (super_admin|event_admin|operator)

branch_members     -- asignación usuario ↔ sucursal (un operario puede rotar)
  id, user_id → profiles, branch_id → branches, assigned_at

-- ══════════ DISPOSITIVOS Y SALDOS ══════════
devices            -- pulsera/llavero NFC o código QR
  id, event_id → events, uid (texto único: ID NFC / contenido QR),
  type (nfc|qr), status (unassigned|active|blocked|retired),
  assigned_profile_id → profiles (asistente dueño), assigned_at,
  replaced_by → devices, created_at

wallets            -- saldo, una por dispositivo (separa saldo de identidad)
  id, device_id → devices (unique), balance numeric(12,2),
  version int,           -- control de concurrencia optimista
  updated_at

attendees          -- persona dueña del dispositivo (registrada en el quiosco)
  id, event_id, full_name, phone, email, document_id, created_at
  (devices.assigned_profile_id apunta aquí de forma efectiva)

-- ══════════ TRANSACCIONES (append-only) ══════════
transactions       -- ledger inmutable, nunca se borra ni edita
  id uuid pk,
  event_id, branch_id, terminal_id, device_id,
  type (initial_load|topup|payment|refund|migration_out|migration_in|adjustment),
  amount numeric(12,2),          -- siempre positivo; el tipo da el sentido
  balance_before, balance_after,
  attendant_id → profiles,      -- operario que ejecutó
  metadata jsonb,               -- productos/items si aplica
  created_at timestamptz default now()

refund_requests    -- solicitudes desde la app móvil
  id, device_id, amount, status (pending|approved|rejected|paid),
  requested_by, processed_by, processed_at, created_at
```

**Reglas de integridad:**
- `devices.uid` único por evento (unique constraint parcial). Nunca se reutiliza un UID.
- `wallets.balance` solo se modifica dentro de transacciones de base de datos (Edge Function).
- `transactions` es append-only (revocar UPDATE/DELETE vía RLS y políticas).
- Índices: `(event_id, created_at desc)`, `(device_id, created_at desc)`, `(branch_id, created_at)`.

---

## 5. Lógica transaccional atómica (Edge Functions)

Toda mutación de saldo pasa por una Edge Function con `pg_advisory_xact_lock(device_id)` para evitar condiciones de carrera cuando dos terminales cobran al mismo dispositivo simultáneamente.

### 5.1 `issue-device` (quiosco de recarga)
1. Valida rol `operator`/`event_admin` y pertenencia a la sucursal.
2. Crea/actualiza `attendee`, crea `devices` (o reutiliza uno `unassigned` pre-cargado por lote) + `wallets(balance=0)`.
3. Ejecuta `initial_load` dentro de la misma transacción: `balance += monto`, inserta `transactions`.
4. Devuelve `{ device_uid, balance }` para mostrar confirmación al cliente.

### 5.2 `charge` (punto de venta — el flujo más ágil)
```
ENTRADA:  device_uid (leído por NFC/QR), amount, terminal_id
TX:
  1. SELECT device FOR UPDATE (advisory lock por uid)
  2. Verificar: existe → evento coincide → status = active
  3. Verificar: balance >= amount (y amount > 0)
  4. UPDATE wallets SET balance = balance - amount, version = version + 1
  5. INSERT transactions (payment, balance_before, balance_after)
SALIDA:   { ok, new_balance, tx_id, device_label }
ERROR:    { error: "not_found"|"blocked"|"insufficient_funds" } (sin mutación)
```
Objetivo de rendimiento: **< 300 ms por cobro**, feedback inmediato en UI (vibración + sonido + color).

### 5.3 `block-and-replace` (dispositivo extraviado)
Una sola transacción: bloquea el dispositivo viejo (`status=blocked`), crea el nuevo, migra el saldo insertando dos transacciones (`migration_out` / `migration_in`). El historial del asistente queda íntegro.

### 5.4 `request-refund` / `process-refund`
La app crea `refund_requests`; el admin aprueba → Edge Function descuenta saldo y registra `refund`. Doble verificación de saldo al ejecutar. El pago del reembolso (efectivo o reversión del medio de pago original) ocurre fuera del sistema, en el punto de reembolso del evento — ver encuadre legal en sección 6.

---

## 6. Encuadre legal del saldo

**El saldo cargado en un dispositivo (pulsera/llavero NFC o QR) es un crédito cerrado de uso interno del evento — no es dinero electrónico ni un instrumento de pago transferible.** Esta distinción es deliberada: evita que el sistema deba tratarse como un emisor de dinero electrónico regulado (en Costa Rica, actividad supervisada por la SUGEF), y mantiene el modelo alineado con el estándar de la industria de festivales/ferias (pulseras cashless cerradas).

Implicaciones que se aplican en todo el sistema:

- **No es retirable a terceros:** el saldo no puede transferirse entre dispositivos, ni a una cuenta bancaria, tarjeta o billetera de un tercero. Solo se consume dentro del evento o se reembolsa a quien lo cargó.
- **Reembolso = devolución del saldo no consumido**, no un pago o transferencia. En el MVP el reembolso se entrega en efectivo o revirtiendo el mismo medio de pago usado en la recarga inicial, procesado en el propio quiosco/punto de reembolso del evento — no hay retiro bancario ni transferencia P2P (eso queda fuera de alcance salvo asesoría legal específica, ver Fase 2/3 en sección 2).
- **`refund_requests` (sección 5.4)** registra la solicitud y aprobación, pero el "pago" del reembolso ocurre fuera del sistema (caja del evento); el sistema solo debita el saldo y deja constancia en el ledger de `transactions` (`type = refund`).
- **Términos y condiciones:** se recomienda que el asistente acepte explícitamente (checkbox o firma en tablet) al momento de la recarga inicial en el quiosco, un texto corto que declare: "Este saldo es un crédito de uso exclusivo dentro de [nombre del evento], no es dinero electrónico, no es transferible y solo es reembolsable según la política del evento." El texto exacto debe validarse con asesoría legal antes de operar con dinero de terceros a escala.
- **`refund_policy` (jsonb en `events`)** debe incluir explícitamente: ventana de tiempo para solicitar reembolso (ej. solo durante el evento o hasta N días después), monto mínimo/máximo, y si aplica alguna comisión administrativa.
- Si en el futuro se quiere ofrecer recarga online + reembolso a tarjeta/cuenta bancaria (mencionado como posible extensión en sección 9, app móvil), eso cambia la naturaleza del saldo hacia un instrumento más cercano a dinero electrónico y **requiere revisión legal/regulatoria previa** — no se debe construir sin validar ese punto primero.

---

## 7. Seguridad y roles (RLS de Supabase)

| Rol | Permisos |
|---|---|
| `super_admin` | CRUD de organizaciones, eventos, branding; acceso total de lectura entre eventos |
| `event_admin` | CRUD de sucursales, terminales, usuarios **dentro de su evento**; dashboard; aprobación de reembolsos; cierre de evento |
| `operator` | Solo su terminal/sucursal: `issue-device`, `charge`, `block-and-replace`. Sin lectura agregada de otros eventos |
| `attendee` (app móvil) | Solo lectura de su propio dispositivo/saldo/historial; creación de `refund_requests` |

Implementación:
- Toda tabla tiene `event_id` → política RLS con `auth.jwt() ->> 'event_role'` y claims de evento en el JWT.
- Claims personalizados vía hook `custom_access_token_hook` (org_id, event_id, role).
- Operadores no consultan saldo libre: las funciones de cobro devuelven solo lo necesario.
- Rate limiting en Edge Functions + validación de `terminal_id` vinculado al usuario.

---

## 8. Frontend PWA (React + Vite + Tailwind)

### 8.1 Estructura de rutas

```
/login                        → selección de evento + credenciales
/e/:eventSlug/admin/*         → panel admin de evento
  ├─ dashboard                → tiempo real
  ├─ branches                 → CRUD sucursales/terminales
  ├─ staff                    → usuarios y asignaciones
  ├─ devices                  → inventario, bloqueos, reemplazos
  ├─ transactions             → historial + filtros + export
  └─ refunds                  → aprobaciones
/e/:eventSlug/kiosk           → modo quiosco (registro + recarga)
/e/:eventSlug/pos             → modo punto de venta (cobro rápido)
```

### 8.2 PWA — requisitos móviles

- **Vite Plugin PWA** (Workbox): `manifest.webmanifest` con iconos por evento (generados desde `logo_url`), `theme_color`/`background_color` desde la paleta del evento (inyectados en runtime desde la config del evento + `<meta name="theme-color">`).
- Service Worker: **network-first para API** (los cobros no pueden fallar por caché), caché estático para assets; cola offline de cobros (Fase 2) con idempotencia por `client_tx_id`.
- **NFC (Web NFC API):** `navigator.nfc` / `NDEFReader` — disponible en Android Chrome. Lectura del UID de la pulsera/llavero. En iOS el Web NFC no existe → la terminal de cobro en iOS opera **solo QR** (cámara con `BarcodeDetector` o librería `html5-qrcode`).
- **QR:** generación del QR del asistente (en ticket/recibo de recarga y en la app móvil) con `qrcode.react`; lectura con `html5-qrcode`.
- **Kiosk mode:** pantalla completa (`requestFullscreen` + Wake Lock API), bloqueo de navegación, grandes botones táctiles.

### 8.3 UX del punto de venta (prioridad: velocidad)

1. Pantalla permanente en modo "esperando escaneo" (cámara/NFC activo).
2. Escaneo automático → muestra tarjeta: nombre del asistente, saldo, últimos 3 consumos.
3. Teclado numérico gigante con monto → botón "COBRAR" a pantalla completa.
4. Feedback triple: vibración (`navigator.vibrate`), sonido (WebAudio), flash verde/rojo.
5. < 2 toques por cobro tras el escaneo. Montos rápidos configurables por sucursal.

### 8.4 Dashboard en tiempo real

- **Supabase Realtime:** `supabase.channel('tx:'+eventId).on('postgres_changes', { table:'transactions' })` → las transacciones nuevas aparecen sin refrescar.
- KPIs: ventas del día, transacciones/minuto, saldo circulante total, dispositivos activos, top sucursales.
- Gráficas con **Recharts** (línea de ingresos por hora, barras por sucursal).
- Auto-refresh de saldo circulante con consulta agregada materializada (o RPC) cada 30 s.

### 8.5 Branding dinámico por evento

Al cargar `/e/:eventSlug`, se obtiene la config del evento y se aplican con CSS variables: `--brand-primary`, `--brand-secondary`; el logo reemplaza el del layout; el manifest y theme-color se actualizan en runtime. Esto permite alquilar el servicio con la identidad de cada feria.

### 8.6 Librerías sugeridas

| Necesidad | Librería |
|---|---|
| Routing | react-router-dom v6 |
| Estado servidor | @tanstack/react-query (+ supabase-js) |
| UI / Tailwind | tailwindcss + shadcn/ui + framer-motion |
| Formularios | react-hook-form + zod |
| NFC | Web NFC API nativa (feature-detect) |
| QR | html5-qrcode (lectura), qrcode.react (generación) |
| Gráficas | recharts |
| PWA | vite-plugin-pwa |

---

## 9. App móvil nativa (Expo / React Native)

**Recomendación: Expo con development build** (no Expo Go, por los módulos nativos NFC).

| Función | Implementación |
|---|---|
| Login asistente | teléfono + OTP (Supabase Auth) vinculado a `attendees.phone` |
| Ver saldo y estado del dispositivo | consulta por `device_uid` o por perfil |
| Historial | lista de `transactions` con filtros |
| Recarga online | pasarela (Stripe, Mercado Pago o institución bancaria) → Edge Function `topup` tras confirmación |
| Mi QR | pantalla con QR grande y brillo máximo para escaneo en punto de venta |
| Solicitar reembolso | formulario → `refund_requests` |
| Notificaciones | Expo Push: recarga confirmada, reembolso aprobado |

**NFC en móvil:** lectura NFC del teléfono no es necesaria para el flujo core (el dispositivo del asistente se escanea en la terminal); se reserva como extra Fase 3. La app se centra en QR + gestión de cuenta.

**Opciones de pasarela para recarga online:**

| Opción | Integración | Notas |
|---|---|---|
| Stripe | Webhook en tiempo real | Cobertura internacional, confirmación instantánea |
| Mercado Pago | Webhook en tiempo real | Fuerte en LATAM, soporta tarjetas y billeteras locales |
| Institución bancaria (ej. SINPE Móvil, transferencia con conciliación) | Depende del banco: webhook/API si el banco lo ofrece, o conciliación por archivo/polling si no | Suele ser la opción de menor comisión, pero la confirmación puede no ser instantánea — la Edge Function `topup` debe soportar un estado `pending` hasta conciliar, no solo `confirmed` |

La arquitectura de `topup` (sección 5) debe admitir ambos modos de confirmación (webhook instantáneo o conciliación diferida) sin cambiar el contrato de la Edge Function hacia el resto del sistema.

---

## 10. Escalabilidad y concurrencia

- **Supabase (proyecto gestionado):** soporta miles de conexiones simultáneas; Realtime escala con sus propias réplicas de lectura. Para eventos masivos: plan Pro/Team con **read replicas** y pooler de conexiones.
- **Cobros atómicos:** `pg_advisory_xact_lock` + `UPDATE ... WHERE balance >= amount` garantizan que jamás haya saldo negativo aunque N terminales cobren al mismo dispositivo en el mismo instante.
- **Idempotencia:** cada cobro lleva `client_tx_id` (uuid generado en la terminal); constraint única evita doble registro por doble tap o reintento de red.
- **Realtime:** el dashboard suscribe solo a `INSERT` de transacciones del evento (filtrado en Postgres Changes), minimizando tráfico.
- **Offline tolerante (Fase 2):** cola en IndexedDB con sincronización y resolución de conflictos por `client_tx_id`; la terminal muestra "pendiente de sincronizar" si pierde conexión.
- **Capacidad estimada MVP:** 2.000–5.000 transacciones/hora sin problema en Supabase Pro; arquitectura preparada para 10×.

---

## 11. Despliegue y entornos

| Capa | Servicio | Notas |
|---|---|---|
| Frontend PWA | **Vercel** | Preview por PR, producción por dominio; variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Backend | **Supabase** | Proyectos: `staging` + `prod`; migraciones SQL versionadas |
| App móvil | EAS (Expo Application Services) | Builds OTA con EAS Update; stores Google Play / App Store |
| Dominios | Vercel Domains | `app.prismacash.io` (global) + opcional dominio por evento |

**CI/CD:** GitHub Actions → lint + tests + build → deploy preview en Vercel → migraciones Supabase aplicadas vía CLI (`supabase db push`) con aprobación manual en prod.

---

## 12. Plan de trabajo por sprints

> **Nota:** esta es una guía de secuencia de trabajo para un desarrollador, no un cronograma con fecha de evento piloto comprometida. Las etiquetas "semana N" indican el orden relativo esperado (cada sprint asume el anterior terminado), no fechas calendario fijas — se ajustan sobre la marcha según disponibilidad real.

### Sprint 1 — Fundaciones (semana 1–2)
- Scaffold Vite + React + TS + Tailwind + shadcn/ui + PWA plugin.
- Supabase: schema completo, migraciones, RLS inicial, seed data.
- Auth + claims de rol; layout con branding dinámico por evento.

### Sprint 2 — Operación core (semana 3–4)
- Modo quiosco: registro asistente, asignación de dispositivo, recarga inicial.
- Modo punto de venta: escaneo QR + NFC (Android), cobro atómico, feedback.
- Flujo de bloqueo/reemplazo con migración de saldo.

### Sprint 3 — Admin y dashboard (semana 5–6)
- CRUD sucursales/terminales/personal.
- Dashboard realtime con KPIs y gráficas.
- Historial de transacciones con filtros y export CSV.

### Sprint 4 — Pulido móvil PWA + hardening (semana 7–8)
- PWA instalable, kiosk mode, Wake Lock, sonidos/vibración.
- Tests E2E del flujo de cobro (Playwright), pruebas de concurrencia (k6/locust sobre `charge`).
- Despliegue staging + piloto en evento real.

### Sprint 5+ — App móvil Expo, reembolsos online, offline mode, analytics.

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Web NFC no disponible en iOS | Terminales iOS = modo QR; híbridas NFC+QR en Android |
| Pérdida de conectividad en el evento | Modo offline con cola idempotente (Fase 2); hotspots 4G/5G de respaldo por sucursal |
| Doble cobro por doble tap | `client_tx_id` único + lock transaccional |
| Fraude con QR fotografiado | QR rotativo en la app (Fase 2, token con TTL) o verificación de monto máximo por transacción |
| Saldo negativo por concurrencia | Advisory lock + `UPDATE ... WHERE balance >= amount` (falla si no cumple) |
| Dependencia de un solo tenant en RLS mal configurado | Tests automáticos de aislamiento entre eventos en CI |

---

## 14. Próximos pasos inmediatos

1. Crear proyecto Supabase (staging) y correr las migraciones del schema (Sección 4).
2. Scaffolding del repo: `npm create vite@latest prismacash -- --template react-ts` + Tailwind + `vite-plugin-pwa`.
3. Implementar Edge Function `charge` con pruebas de concurrencia (k6).
4. Maquetar el modo punto de venta (pantalla más crítica del producto).

---

*Documento generado como plan maestro. Cada sección es implementable de forma independiente siguiendo el orden de sprints.*
