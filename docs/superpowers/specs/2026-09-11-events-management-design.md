# Events Management — Design / Spec

**Fecha:** 2026-09-11 · **Feature:** CRUD de eventos para `super_admin` (demo de cliente).

## Objetivo

Dar a `super_admin` control total sobre la plataforma desde la UI: crear, editar,
eliminar y abrir eventos. Junto al CRUD ya existente de usuarios, sucursales y
dispositivos, esto completa el kit de administración global para la demo.

## Alcance

- **Dentro:** página de Eventos en el admin con listado global de todos los eventos
  (todas las organizaciones) y CRUD completo (crear / editar / eliminar / abrir).
- **Fuera de alcance:** CRUD de organizaciones, gestión de attendees, aprobación de
  reembolsos, cambios en branches/devices/staff/transactions/refunds, app móvil.

## Roles y permisos

- La página y el nav item "Eventos" se muestran **solo para `super_admin`**.
  `event_admin` no lo ve y si accede por URL → sin acceso (mismo guard de AdminLayout).
- **Backend ya listo:** políticas RLS `super_admin_all_events` y
  `super_admin_all_organizations` (`for all using/with check is_super_admin()`)
  en `0001_init.sql:196-200` → INSERT/UPDATE/DELETE/SELECT para super_admin vía PostgREST.
  No se necesitan migraciones ni Edge Functions.

## Reglas de datos (schema `0001_init.sql`)

- `events.org_id uuid not null references organizations(id) on delete cascade` →
  el modal de crear/editar exige selector de organización (se carga
  `supabase.from('organizations').select('id, name, slug')` — super_admin lee todas).
- `events.slug text not null unique` → auto-generado desde el nombre (slugify) y
  editable; sobre error 23505 (slug duplicado) se muestra mensaje en el modal.
- `events.status` enum `draft | active | closed`; `events.device_type` enum
  `nfc | qr | hybrid`; `currency` default `CRC`; `brand_primary`/`brand_secondary`
  default `#B5691A`/`#187A5D` (ya tienen defaults en la tabla ⇒ se omiten si no se editan).
- Borrar un evento elimina en cascada `branches`, `terminals`, `attendees`, `devices`,
  `wallets`, `transactions`, `refund_requests` (FK `on delete cascade`) ⇒ diálogo
  destructivo con advertencia explícita e irreversible.

## UI

- Ruta: `/e/:eventSlug/admin/events` (hija de AdminLayout, igual que branches/devices).
- `src/pages/admin/Events.tsx` — tabla con todas los eventos: nombre, slug, estado
  (pill), tipo de dispositivo, moneda, organización (embed `organizations!inner(name)`),
  inicio, cierre y acciones **Abrir / Editar / Eliminar**. Botón "Nuevo evento".
- "Abrir" navega a `/e/{slug}/admin/dashboard` (entrar al admin de ese evento).
- Modales en `src/pages/admin/events/`: `CreateEventModal.tsx`, `EditEventModal.tsx`,
  `ConfirmDeleteEventDialog.tsx`.
- Patrón idéntico al CRUD de Branches/Devices: `supabase.from()` directo con RLS,
  inputs controlados (`useState`), **sin react-hook-form ni zod**, `Modal`/`ConfirmDialog`
  reutilizados de `src/pages/admin/staff/`.

## Contratos de frontend

- Query key del listado global: `['admin-all-events']`; la invalidación tras
  crear/editar/borrar usa `queryClient.invalidateQueries({ queryKey: ['admin-all-events'] })`.
- Embed de FK por nombre de tabla plural: `organizations!inner(name)` (lección
  PostgREST del proyecto — NUNCA `organization`).
- Tipos de la tabla eventos para el frontend: fila con `id, org_id, name, slug,
  status, device_type, currency, brand_primary, brand_secondary, starts_at,
  ends_at, organizations: { name } | null`.

## No placeholders / verificación

- `npm run build` (tsc -b + vite) y `npm run lint` en verde tras cada tarea.
- Verificación manual E2E: como `super_admin`, crear evento (ver slug auto),
  abrirlo, editar slug duplicado (error 23505), borrarlo (advertencia cascada);
  como `event_admin`, confirmar que el nav "Eventos" no aparece.