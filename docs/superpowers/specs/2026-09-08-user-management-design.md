# Especificación — UI de Gestión de Usuarios (Staff CRUD)

Fecha: 2026-09-08
Proyecto: PrismaCash
Estado: Aprobado

## Resumen

Evolucionar la pantalla `Staff.tsx` en una gestión completa de usuarios con CRUD: crear (manual o por email), editar y eliminar. Solo el `super_admin` gestiona; el `event_admin` solo consulta.

## Alcance

- Flujo de alta manual con email + contraseña + nombre + rol (+ asignaciones según rol)
- Flujo de invitación por email con rol y asignaciones
- Edición completa de perfil (nombre, teléfono, email, contraseña, rol)
- Eliminación dura de usuario (auth.users + cascada)
- Cambio de rol atómico con advertencia de asignaciones que se perderán
- Confirmación en todas las operaciones
- Solo super_admin ejecuta; event_admin solo lectura

## Fuera de alcance

- App móvil nativa (Fase 2)
- Gestión de usuarios por parte de event_admin
- Desactivación de usuarios (solo eliminación dura)
- Hiper-asignación multi-evento (el modelo es single-event-per-account)

## Backend

Cuatro Edge Functions, patrón consistente con `charge`/`topup` (service_role + validación `is_super_admin`):

### `create-user`
- Input: `email`, `password` (si manual), `full_name`, `phone?`, `role` (`event_admin` | `operator`), `assignments?` (branches para operator / eventos para event_admin)
- Validaciones: email único, contraseña mínima (si manual), rol permitido (nunca `super_admin` por UI)
- Flujo: `auth.admin.createUser()` → INSERT en `profiles` → INSERT en `event_admins`/`branch_members` si hay asignaciones
- Transacción lógica: si falla el perfil o las asignaciones, rollback del usuario creado

### `invite-user`
- Input: `email`, `full_name`, `role`, `assignments?`
- Flujo: `auth.admin.inviteUserByEmail()` → INSERT en `profiles` (rol definido) → INSERT en `event_admins`/`branch_members`
- Idéntica validación de rol y asignaciones que `create-user`

### `update-user`
- Input: `user_id`, `full_name?`, `phone?`, `email?`, `password?`, `role?`, `assignments?`
- Cambio de email: `auth.admin.updateUserById()`
- Cambio de contraseña: solo si se provee, `auth.admin.updateUserById()`
- Cambio de rol: operación atómica —
  - De operator→event_admin: elimina `branch_members`, valida/crea `event_admins`
  - De event_admin→operator: elimina `event_admins`, deja listo para branches
  - Flujo de confirmación en 2 pasos: (1) el backend retorna `error: 'confirm_assignment_loss'` con la lista de asignaciones que se perderían si detecta que las hay; (2) el frontend muestra el warning y reenvía con `confirm_loss: true`; (3) el backend aplica la operación
- Cambios de asignaciones: consolida (borra + inserta) `branch_members`/`event_admins`

### `delete-user`
- Input: `user_id`
- Flujo: `auth.admin.deleteUser()` — cascada elimina `profiles`, `event_admins`, `branch_members`
- Destructivo, no reversible

## Frontend

### Staff.tsx (evolucionado)

- Tabs: Todos / Admins / Operators — misma tabla filtrada
- Tabla: Nombre (avatar con inicial), Email, Rol (badge), Asignaciones, Acciones
- Búsqueda por nombre/email (input de texto)
- Botones (solo super_admin): "Crear usuario", "Invitar por email"
- Fila (solo super_admin): Editar, Eliminar
- event_admin: solo tabla de lectura

### Modales

1. **Crear usuario** — 2 pasos: (1) email, nombre, teléfono, rol, contraseña (checkbox "generar automáticamente" default/manual) → (2) asignaciones (branches si operator, evento si event_admin)
2. **Invitar por email** — 2 pasos: (1) email, nombre, rol → (2) asignaciones
3. **Editar usuario** — todos los campos editables; contraseña opcional (reset); cambio de rol con warning de asignaciones perdidas
4. **Confirmaciones** — crear, invitar, editar, eliminar, cambiar rol (todas con confirmación explícita)

### Flujo de datos

- `supabase.functions.invoke()` con sesión; errores via patrón `functionError.ts`
- Validación de campos en formulario (react-hook-form + zod, patrón existente)
- Tras cada operación: invalidar query de React Query → refresco de tabla
- JWT del usuario editado no cambia hasta nuevo login (limitación conocida del hook `custom_access_token_hook`)

## Testing

- Unit tests de helpers de roles/asignaciones
- Build + lint en verde
- Verificación manual: login super_admin (gestiona) vs event_admin (solo lectura)

## Migraciones

Sin cambios de schema. La migración 0012 ya está aplicada (branch_members ALL para super_admin).

## Componentes nuevos

```
src/pages/admin/
  Staff.tsx          (evolucionado: tabs + tabla + acciones)
  staff/
    UserTabs.tsx        → tabs de filtro por rol
    UserTable.tsx       → tabla de usuarios
    UserModals.tsx      → contenedor de modales
    CreateUserModal.tsx / InviteUserModal.tsx / EditUserModal.tsx
    confirm-dialogs.tsx  → diálogos de confirmación
```