# Superadmin: navegación entre pantallas y gestión de asignación a sucursal

Fecha: 2026-09-07
Estado: Aprobado

## Contexto

Actualmente el superadmin aterriza siempre en `/e/{slug}/admin` al iniciar sesión
(`src/lib/sessionRole.ts:29` → `homePathForRole`). No existe navegación visual
entre las tres pantallas operativas: dashboard, kiosk y POS. Para moverse solo se
puede editar la URL manualmente.

Hallazgo clave verificado en el código: las Edge Functions `charge` y `topup`
solo validan membresía de sucursal cuando el cliente envía `branch_id`
(`supabase/functions/charge/index.ts:36`, `supabase/functions/topup/index.ts:35`).
Ni `Pos.tsx` ni `Kiosk.tsx` envían `branch_id`, por lo que un superadmin **puede
operar POS y Kiosk de verdad sin ser `branch_member`**. La gestión de asignación
usuario→sucursal en el panel admin es una mejora general de gestión de personal,
no un requisito del flujo.

## Objetivos

1. Que el superadmin pueda saltar entre dashboard ↔ kiosk ↔ pos desde la UI.
2. Que los enlaces estén restringidos al rol `super_admin`.
3. Que Personal (`Staff.tsx`) permita asociar/desasociar un usuario a una
   sucursal, solo para superadmin.

## Decisiones

- Acceso en modo **funcionamiento real**: POS y Kiosk operan como siempre; no hay
  modo preview/solo-lectura (decidido con el usuario).
- Se adopta la opción A: enlaces en el sidebar de admin + vínculo de vuelta en el
  topbar de kiosk/POS.
- El rol se lee del JWT a través de `readClaims` (`src/lib/sessionRole.ts:10`).

## Cambios

### 1. Hook `useSessionRole()`

Nuevo `src/hooks/useSessionRole.ts`:

- Usa `useAuth().session` (contexto existente) y `readClaims(session)`.
- Devuelve `SessionRole` (`'super_admin' | 'event_admin' | 'operator' | null`).
- Es el único punto que decide "¿es superadmin?" en las tres pantallas.

### 2. Navegación superadmin

**`src/pages/admin/AdminLayout.tsx`**

- Nueva sección "Pantallas operativas" en el sidebar, debajo de la navegación
  actual, con dos enlaces:
  - Kiosk → `/e/{eventSlug}/kiosk`
  - Punto de venta → `/e/{eventSlug}/pos`
- Se renderiza solo si `role === 'super_admin'`.

**`src/pages/Pos.tsx` y `src/pages/Kiosk.tsx`**

- Vínculo discreto "← Dashboard" en el topbar → `/e/{eventSlug}/admin`.
- Visible solo para superadmin.

### 3. Staff: gestión de asignación usuario→sucursal (solo superadmin)

**DB — nueva migración** `supabase/migrations/0012_super_admin_branch_members.sql`:

- Política RLS sobre `branch_members`:
  `create policy super_admin_all_branch_members on branch_members for all using (is_super_admin()) with check (is_super_admin());`
- Hoy `branch_members` solo tiene políticas `SELECT` (`0001_init.sql:189`,
  `0011_admin_read_and_realtime.sql:20`); no hay forma de escribir vía cliente.

**`src/pages/admin/Staff.tsx`**

- Los controles se muestran solo si `role === 'super_admin'`; `event_admin`
  conserva la vista de solo lectura actual.
- Control "Asociar persona":
  - Select de sucursal (branches del evento, campo `id`).
  - Select de usuario (perfiles con `role = 'operator'`, excluyendo los ya
    asignados a la sucursal elegida).
  - Insert en `branch_members { user_id, branch_id }`.
- Botón "Quitar" en cada PersonCard que tenga sucursal:
  - Delete de la fila de `branch_members` por su `id` (columna que la query de
    Staff ya selecciona).
- Tras insert/delete: invalidar la query `admin-staff-members` de react-query para
  refrescar la lista.

### 4. Datos y errores

- Feedback de error inline (texto simple), acorde al estilo actual del panel.
- Cargando/inmutaciones siguen el patrón `setLoading`/`isPending` ya usado.

## Fuera de alcance

- Modo preview / solo-lectura para kiosk/POS.
- Gestión de roles globales (cambiar `operator` a `event_admin`, etc.).
- Alta de eventos, sucursales o terminales desde la UI.
- Guarda de ruta estricta por rol (`RequireAuth` sigue validando solo sesión);
  la restricción es a nivel de UI (visibilidad de enlaces).