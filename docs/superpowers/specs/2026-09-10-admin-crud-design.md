# Spec: Admin CRUD — Sucursales, Dispositivos y Fix Login Redirect

Fecha: 2026-09-10
Estado: borrador

## Resumen

Agregar CRUD completo a las pantallas de Sucursales y Dispositivos del admin panel, y corregir el redirect del login para que el super_admin ingrese al admin panel en vez de kiosk. Todo con calidad de presentación a clientes.

## Contexto

- Stack: Vite 8 + React 19 + TypeScript + Tailwind 4 + Supabase + TanStack Query
- Backend: operaciones directas vía `supabase.from()` (RLS permite todo a super_admin)
- Patrón UI: modales inline (ya probado en Staff)
- Proyecto Supabase: `lhvqpymbgkjyfdcryhzp`
- El admin panel ya existe con sidebar, 6 secciones, y páginas de solo lectura

## Alcance

### Fix 1: Login redirect (super_admin → admin panel)

**Problema**: Al hacer login como super_admin, se ingresa a `/kiosk` en vez de `/admin`.

**Causa raíz probable**: El `custom_access_token_hook` no está habilitado en Supabase Dashboard, o la sesión es anterior a la activación del hook.

**Solución**:
1. Verificar que el hook esté configurado: Supabase Dashboard → Authentication → Hooks → `custom_access_token_hook`
2. Si no está, habilitarlo con la función SQL ya existente (migración 0009)
3. Agregar fallback en `Login.tsx`: si `readClaims` retorna `role: null`, consultar `profiles` table como respaldo
4. Agregar guard en `AdminLayout`: si el rol no es `super_admin` ni `event_admin`, redirigir a `/login`

### Fix 2: Join query en Staff.tsx

**Problema**: Query usa `profile(id)` pero el FK es `user_id` → PostgREST espera `user(id)`.

**Solución**: Cambiar `profile(id)` → `user(id)` en la query, interfaz `MemberBridge`, y uso (`m.profile?.id` → `m.user?.id`). **Ya aplicado.**

### Feature 1: CRUD de Sucursales (Branches)

**Operaciones**:
- **Crear**: modal con nombre, tipo (recharge_kiosk / sales_point / both), estado activo/inactivo
- **Editar**: modal pre-cargado, permite editar nombre, tipo, estado
- **Eliminar**: confirmación destructiva; warning si tiene terminales vinculadas
- **Ver terminales**: sección expandible por sucursal (lectura, ya parcialmente existe)

**Componentes nuevos** (en `src/pages/admin/branches/`):
- `CreateBranchModal.tsx` — formulario 1 paso
- `EditBranchModal.tsx` — pre-carga valores
- `ConfirmDeleteDialog.tsx` — reutilizable entre Branches y Devices

**Cambios en `Branches.tsx`**:
- Tabla profesional en vez de cards
- Botón "Nueva sucursal"
- Iconos de editar/eliminar por fila
- Badges de tipo y estado
- Click expande terminales vinculadas
- Loading states y empty states

**Backend**: `supabase.from('branches').insert()`, `.update()`, `.delete()` directo.

### Feature 2: CRUD de Dispositivos (Devices)

**Operaciones**:
- **Crear**: modal con UID, tipo (nfc/qr), asistente (select opcional de attendees del evento)
- **Editar**: cambiar status, tipo, asistente
- **Eliminar**: confirmación destructiva
- **Ver detalles**: modal expandido con saldo, transacciones recientes, estado

**Componentes nuevos** (en `src/pages/admin/devices/`):
- `CreateDeviceModal.tsx`
- `EditDeviceModal.tsx`
- `DeviceDetailModal.tsx`
- `ConfirmDeleteDialog.tsx` (reutilizar de branches)

**Cambios en `Devices.tsx`**:
- Botón "Nuevo dispositivo"
- Fila clickeable para ver detalles
- Iconos de editar/eliminar
- Badges de estado con colores
- Filtro por estado (activo/bloqueado/retirado/sin asignar)

**Backend**: `supabase.from('devices').insert()`, `.update()`, `.delete()` directo.

## Archivos a modificar/crear

### Modificar
- `src/pages/Login.tsx` — fallback de role si readClaims retorna null
- `src/pages/admin/AdminLayout.tsx` — guard de rol
- `src/pages/admin/Branches.tsx` — reescritura con tabla + CRUD
- `src/pages/admin/Devices.tsx` — reescritura con tabla + CRUD

### Crear
- `src/pages/admin/branches/CreateBranchModal.tsx`
- `src/pages/admin/branches/EditBranchModal.tsx`
- `src/pages/admin/branches/ConfirmDeleteDialog.tsx`
- `src/pages/admin/devices/CreateDeviceModal.tsx`
- `src/pages/admin/devices/EditDeviceModal.tsx`
- `src/pages/admin/devices/DeviceDetailModal.tsx`

## Decisiones de diseño

1. **No Edge Functions**: super_admin tiene RLS full access en branches y devices. Operaciones directas desde el cliente son suficientes y más simples.
2. **Modales inline**: patrón probado en Staff, consistente con el resto del admin panel.
3. **ConfirmDeleteDialog reutilizable**: mismo componente para branches y devices.
4. **Tabla profesional**: en vez de cards, para verse mejor en presentación a clientes.
5. **Sin wizard de 2 pasos**: las operaciones son simples (1 paso cada una).

## Restricciones

- No crear/editar/eliminar super_admin desde la UI (ya existe en Staff)
- Eliminar device implica cascada a wallets (RLS maneja)
- Eliminar branch implica cascada a branch_members y terminals (RLS maneja)
- El auth hook ya está creado (migración 0009), solo necesita habilitarse

## Criterios de éxito

1. Super_admin ingresa a `/admin` después del login
2. Sucursales: crear, editar, eliminar con confirmación
3. Dispositivos: crear, editar, eliminar con confirmación, ver detalles
4. UI profesional, consistente, sin errores de build/lint
5. Funciona con el evento `demo` de prueba
