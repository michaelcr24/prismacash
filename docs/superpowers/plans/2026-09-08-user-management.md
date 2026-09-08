# UI de Gestión de Usuarios (Staff CRUD) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `Staff.tsx` en una gestión completa de usuarios (crear/invitar/editar/eliminar) limitada a `super_admin`, con `event_admin` en modo lectura.

**Architecture:** 4 Edge Functions (`create-user`, `invite-user`, `update-user`, `delete-user`) que validan `super_admin` y mutan vía service role; una vista SQL `staff_users` para exponer el email de `auth.users` respetando las políticas RLS de `profiles`; y el frontend de Staff con tabs + tabla + modales.

**Tech Stack:** Deno Edge Functions (supabase-js via `jsr:`), React 19 + TanStack Query + react-router-dom 7, Supabase JS client.

## Global Constraints

- La UI solo permite roles `event_admin` y `operator`. **Nunca** se crea/cambia a `super_admin` desde la UI.
- No introducir react-hook-form/zod: los formularios existentes usan inputs controlados con `useState` (patrón de `Staff.tsx`, `Pos.tsx`, `Kiosk.tsx`).
- Contrato de errores de Edge Functions: `{ ok: false, error: '<code>' }` con status no-2xx; frontend recupera el code con el patrón de `readFunctionErrorCode`.
- `supabase/functions/*` está fuera de `tsconfig` y `eslint` (ver `eslint.config.js:12`) → **no hay typecheck local** para funciones (no hay CLI de Supabase ni Deno en esta máquina). Se verifica por revisión + deploy manual al final.
- El proyecto Supabase no está linkeado al CLI: migraciones y Edge Functions se aplican manualmente (SQL Editor / Dashboard). Tarea final incluye los pasos.
- Copy de UI en español.
- Los JWT no se refrescan en mitad de sesión (`custom_access_token_hook`): cambiar el rol de un usuario no surte efecto en su token actual hasta nuevo login. Mostrar nota cuando aplique.

---

## File Structure

**Backend (nuevos):**
- `supabase/functions/_shared/admin.ts` — `authenticateSuperAdmin()` + `AuthedAdmin`
- `supabase/functions/_shared/users.ts` — helpers de asignaciones + errores de auth
- `supabase/functions/create-user/index.ts`
- `supabase/functions/invite-user/index.ts`
- `supabase/functions/update-user/index.ts`
- `supabase/functions/delete-user/index.ts`

**Migración (nueva):**
- `supabase/migrations/0013_staff_users_view.sql` — vista `staff_users` (email + profile, security_invoker)

**Frontend (nuevos):**
- `src/pages/admin/staff/api.ts` — wrappers de `functions.invoke` + `UserApiError`
- `src/pages/admin/staff/Modal.tsx` — shell de modal
- `src/pages/admin/staff/ConfirmDialog.tsx` — confirmación genérica (items opcionales)
- `src/pages/admin/staff/CreateUserModal.tsx`
- `src/pages/admin/staff/InviteUserModal.tsx`
- `src/pages/admin/staff/EditUserModal.tsx`
- `src/pages/admin/staff/UserTable.tsx`

**Frontend (modificar):**
- `src/hooks/useEvent.ts` — añadir `org_id` al select
- `src/pages/admin/Staff.tsx` — reescritura completa (tabs + búsqueda + acciones)

---

### Contratos entre tareas

`_shared/admin.ts`:
```
authenticateSuperAdmin(req: Request):
  Promise<{ ok: true; value: AuthedAdmin } | { ok: false; response: Response }>
AuthedAdmin = { userClient: SupabaseClient; adminClient: SupabaseClient; userId: string }
  adminClient se crea con SERVICE_ROLE_KEY; userClient con el token del caller.
  // Verifica rol: profiles.role === 'super_admin' para el usuario autenticado.
```

`_shared/users.ts`:
```
authErrorCode(error: { message?: string }): string  // 'email_exists' | 'user_not_found' | 'invalid_password' | 'auth_error'
resolveOrgOfEvent(adminClient, eventId: string): Promise<string | null>
assignEventAdmin(adminClient, userId: string, eventId: string): Promise<void>
reconcileBranchMembers(adminClient, userId: string, eventId: string, branchIds: string[]): Promise<void>
assignmentsToLose(adminClient, userId: string, currentRole: string, targetRole: string): Promise<string[]>
reconcileAssignmentsForRole(adminClient, userId: string, eventId: string, role: string, branchIds: string[]): Promise<void>
```

`src/pages/admin/staff/api.ts`:
```
export type ManageRole = 'event_admin' | 'operator'
export interface CreateUserInput { email: string; password?: string; full_name?: string; phone?: string; role: ManageRole; event_id: string; branch_ids?: string[] }
export interface InviteUserInput { email: string; full_name?: string; role: ManageRole; event_id: string; branch_ids?: string[] }
export interface UpdateUserInput { user_id: string; full_name?: string; phone?: string; email?: string; password?: string; role?: ManageRole; event_id: string; branch_ids?: string[]; confirm_loss?: boolean }
export class UserApiError extends Error { code: string | null; payload: unknown }
export function createUser(input: CreateUserInput): Promise<{ ok: true; user_id: string; generated_password?: string }>
export function inviteUser(input: InviteUserInput): Promise<{ ok: true; user_id: string }>
export function updateUser(input: UpdateUserInput): Promise<{ ok: true; user_id: string }>
export function deleteUser(user_id: string): Promise<{ ok: true }>
```

`Staff.tsx` query keys: `['admin-staff-users', eventId]`, `['admin-staff-admins', eventId]`, `['admin-staff-members', eventId]`, `['admin-staff-branches', eventId]`.

---

### Task 1: Vista `staff_users` (migración 0013)

**Files:**
- Create: `supabase/migrations/0013_staff_users_view.sql`

**Interfaces:**
- Consumes: tablas `auth.users` y `profiles` de la migración 0001.
- Produces: vista `public.staff_users` con columnas `id, org_id, email, full_name, phone, role` (la consume Staff.tsx en Task 7).

- [ ] **Step 1: Crear la migración**

```sql
-- 0013_staff_users_view.sql
-- Expone el email (única columna que vive en auth.users) junto al perfil,
-- respetando las políticas RLS de profiles vía security_invoker.
create or replace view public.staff_users
with (security_invoker = true) as
select
  p.id,
  p.org_id,
  coalesce(u.email, '') as email,
  p.full_name,
  p.phone,
  p.role
from auth.users u
join profiles p on p.id = u.id;

grant select on public.staff_users to authenticated;
```

- [ ] **Step 2: Aplicar la migración (manual)**

Run: (SQL Editor del proyecto `lhvqpymbgkjyfdcryhzp`) — pegar el contenido del paso 1 y ejecutar. No hay CLI linkeado.

Expected: la vista se crea; `GRANT` exitoso.

- [ ] **Step 3: Verificación manual en SQL Editor**

Run: `select id, email, role from staff_users;`
Expected: devuelve los perfiles existentes con su email.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_staff_users_view.sql
git commit -m "db: staff_users view exposing auth.users email with RLS"
```

---

### Task 2: Helpers compartidos `_shared/admin.ts` y `_shared/users.ts`

**Files:**
- Create: `supabase/functions/_shared/admin.ts`
- Create: `supabase/functions/_shared/users.ts`

**Interfaces:**
- Consumes: `json` de `./cors.ts`; nada más.
- Produces: `authenticateSuperAdmin`, `AuthedAdmin` para Tasks 3-6; helpers de asignaciones para Tasks 3-5.

- [ ] **Step 1: Crear `admin.ts`**

```ts
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json } from './cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface AuthedAdmin {
  userClient: SupabaseClient
  adminClient: SupabaseClient
  userId: string
}

/**
 * Valida el JWT del caller y exige que su perfil sea super_admin.
 * `adminClient` (service_role) se usa para todas las mutaciones.
 */
export async function authenticateSuperAdmin(
  req: Request,
): Promise<{ ok: true; value: AuthedAdmin } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { ok: false, response: json({ ok: false, error: 'unauthorized' }, 401) }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser()
  if (error || !user) return { ok: false, response: json({ ok: false, error: 'unauthorized' }, 401) }

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'super_admin') return { ok: false, response: json({ ok: false, error: 'forbidden' }, 403) }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  return { ok: true, value: { userClient, adminClient, userId: user.id } }
}
```

- [ ] **Step 2: Crear `users.ts`**

```ts
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export function authErrorCode(error: { message?: string }): string {
  const msg = (error?.message ?? '').toLowerCase()
  if (msg.includes('already registered') || msg.includes('duplicate')) return 'email_exists'
  if (msg.includes('password')) return 'invalid_password'
  if (msg.includes('does not exist')) return 'user_not_found'
  return 'auth_error'
}

export async function resolveOrgOfEvent(adminClient: SupabaseClient, eventId: string): Promise<string | null> {
  const { data } = await adminClient.from('events').select('org_id').eq('id', eventId).maybeSingle()
  return data?.org_id ?? null
}

export async function assignEventAdmin(adminClient: SupabaseClient, userId: string, eventId: string): Promise<void> {
  await adminClient.from('event_admins').insert({ user_id: userId, event_id: eventId }).onConflict('user_id,event_id').ignore()
}

export async function reconcileBranchMembers(
  adminClient: SupabaseClient,
  userId: string,
  eventId: string,
  branchIds: string[],
): Promise<void> {
  const target = new Set(branchIds ?? [])
  const { data: eventBranches } = await adminClient.from('branches').select('id').eq('event_id', eventId)
  const eventBranchIds = (eventBranches ?? []).map((b) => b.id)
  if (eventBranchIds.length === 0) return

  const { data: current } = await adminClient
    .from('branch_members')
    .select('id, branch_id')
    .eq('user_id', userId)
    .in('branch_id', eventBranchIds)

  const toDelete = (current ?? []).filter((c) => !target.has(c.branch_id)).map((c) => c.id)
  if (toDelete.length) await adminClient.from('branch_members').delete().in('id', toDelete)

  const existing = new Set((current ?? []).map((c) => c.branch_id))
  const toInsert = [...target]
    .filter((branchId) => !existing.has(branchId))
    .map((branch_id) => ({ user_id: userId, branch_id }))
  if (toInsert.length) await adminClient.from('branch_members').insert(toInsert)
}

export async function assignmentsToLose(
  adminClient: SupabaseClient,
  userId: string,
  currentRole: string,
  targetRole: string,
): Promise<string[]> {
  if (currentRole === targetRole) return []
  if (targetRole === 'event_admin' && currentRole === 'operator') {
    const { data } = await adminClient.from('branch_members').select('branch(name)').eq('user_id', userId)
    return (data ?? []).map((r) => `Sucursal: ${r.branch?.name ?? 'sin nombre'}`)
  }
  if (targetRole === 'operator' && currentRole === 'event_admin') {
    const { data } = await adminClient.from('event_admins').select('id').eq('user_id', userId)
    return (data ?? []).length ? ['Asignación como administrador de evento'] : []
  }
  return []
}

export async function reconcileAssignmentsForRole(
  adminClient: SupabaseClient,
  userId: string,
  eventId: string,
  role: string,
  branchIds: string[],
): Promise<void> {
  if (role === 'event_admin') {
    await adminClient.from('branch_members').delete().eq('user_id', userId)
    await assignEventAdmin(adminClient, userId, eventId)
  } else {
    await adminClient.from('event_admins').delete().eq('user_id', userId)
    await reconcileBranchMembers(adminClient, userId, eventId, branchIds)
  }
}
```

- [ ] **Step 3: Verificación**

No hay typecheck local (fuera de tsconfig/eslint). Revisión visual: importar `json` desde `./cors.ts` (mismo path relativo que `operator.ts`), tipos `SupabaseClient` con `import type`, y firma exacta de `authErrorCode` para Tasks 3-6.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/admin.ts supabase/functions/_shared/users.ts
git commit -m "feat: shared helpers for super-admin user management functions"
```

---

### Task 3: Edge Function `create-user`

**Files:**
- Create: `supabase/functions/create-user/index.ts`

**Interfaces:**
- Consumes: `authenticateSuperAdmin` (Task 2), `authErrorCode`/`resolveOrgOfEvent`/`assignEventAdmin`/`reconcileBranchMembers` (Task 2), `corsHeaders`/`json`.
- Produces: responde 200 `{ ok: true, user_id, generated_password? }` o error con código. La consume `createUser()` de Task 6.

- [ ] **Step 1: Crear la función**

```ts
import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import {
  assignEventAdmin,
  authErrorCode,
  reconcileBranchMembers,
  resolveOrgOfEvent,
} from '../_shared/users.ts'

interface CreateUserRequest {
  email: string
  password?: string
  full_name?: string
  phone?: string
  role: 'event_admin' | 'operator'
  event_id: string
  branch_ids?: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: CreateUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400)
  if (body.role !== 'event_admin' && body.role !== 'operator') return json({ ok: false, error: 'invalid_role' }, 400)
  if (!body.event_id) return json({ ok: false, error: 'invalid_body' }, 400)
  const wantsManualPassword = typeof body.password === 'string' && body.password !== ''
  if (wantsManualPassword && body.password!.length < 8) return json({ ok: false, error: 'password_too_short' }, 400)

  // El super_admin nunca introduce roles super_admin; solo event_admin/operator.
  const generatedPassword = wantsManualPassword ? undefined : crypto.randomUUID().slice(0, 10)
  const password = wantsManualPassword ? body.password! : generatedPassword!

  let userId: string | null = null
  try {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: body.full_name ? { full_name: body.full_name } : undefined,
    })
    if (error) return json({ ok: false, error: authErrorCode(error) }, 409)
    userId = data.user!.id

    const orgId = await resolveOrgOfEvent(adminClient, body.event_id)
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userId,
      org_id: orgId,
      full_name: body.full_name?.trim() || null,
      phone: body.phone?.trim() || null,
      role: body.role,
    })
    if (profileError) throw profileError

    if (body.role === 'event_admin') {
      await assignEventAdmin(adminClient, userId, body.event_id)
    } else {
      await reconcileBranchMembers(adminClient, userId, body.event_id, body.branch_ids ?? [])
    }
  } catch (e) {
    console.error('create-user error', e)
    if (userId) await adminClient.auth.admin.deleteUser(userId).catch(() => {})
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json({ ok: true, user_id: userId!, generated_password: generatedPassword }, 200)
})
```

- [ ] **Step 2: Verificación**

Revisión visual (sin typecheck local). Confirmar: `crypto.randomUUID` disponible en Deno; la firma `createUser({ email, password, email_confirm, user_metadata })`; rollback con `deleteUser` en el catch. Nota de seguridad: si `deleteUser` falla tras un perfil sin insertar, un usuario huérfano queda en auth.users — el hook de claims (`custom_access_token_hook`) no le da claims útiles, así que no accede a nada. Aceptado.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-user/index.ts
git commit -m "feat: create-user edge function (manual signup, super_admin only)"
```

---

### Task 4: Edge Function `invite-user`

**Files:**
- Create: `supabase/functions/invite-user/index.ts`

**Interfaces:**
- Consumes: helpers de Task 2 (idénticos a Task 3).
- Produces: responde 200 `{ ok: true, user_id }` o error. La consume `inviteUser()` de Task 6.

- [ ] **Step 1: Crear la función**

```ts
import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import {
  assignEventAdmin,
  authErrorCode,
  reconcileBranchMembers,
  resolveOrgOfEvent,
} from '../_shared/users.ts'

interface InviteUserRequest {
  email: string
  full_name?: string
  role: 'event_admin' | 'operator'
  event_id: string
  branch_ids?: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: InviteUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400)
  if (body.role !== 'event_admin' && body.role !== 'operator') return json({ ok: false, error: 'invalid_role' }, 400)
  if (!body.event_id) return json({ ok: false, error: 'invalid_body' }, 400)

  let userId: string | null = null
  try {
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: body.full_name ? { full_name: body.full_name } : undefined,
    })
    if (error) return json({ ok: false, error: authErrorCode(error) }, 409)
    userId = data.user!.id

    const orgId = await resolveOrgOfEvent(adminClient, body.event_id)
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userId,
      org_id: orgId,
      full_name: body.full_name?.trim() || null,
      phone: null,
      role: body.role,
    })
    if (profileError) throw profileError

    if (body.role === 'event_admin') {
      await assignEventAdmin(adminClient, userId, body.event_id)
    } else {
      await reconcileBranchMembers(adminClient, userId, body.event_id, body.branch_ids ?? [])
    }
  } catch (e) {
    console.error('invite-user error', e)
    if (userId) await adminClient.auth.admin.deleteUser(userId).catch(() => {})
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json({ ok: true, user_id: userId! }, 200)
})
```

- [ ] **Step 2: Verificación**

Revisión visual. Confirmar firma de `inviteUserByEmail(email, { data })` y que el usuario invitado queda con `email_confirm = false` (el email de invitación llega del propio GoTrue).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/invite-user/index.ts
git commit -m "feat: invite-user edge function (email invite, super_admin only)"
```

---

### Task 5: Edge Function `update-user`

**Files:**
- Create: `supabase/functions/update-user/index.ts`

**Interfaces:**
- Consumes: helpers de Task 2 (`authenticateSuperAdmin`, `authErrorCode`, `assignmentsToLose`, `reconcileAssignmentsForRole`).
- Produces: 200 `{ ok: true, user_id }` | 409 `{ ok: false, error: 'confirm_assignment_loss', assignments: string[] }`. La consume `updateUser()` de Task 6.

- [ ] **Step 1: Crear la función**

```ts
import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import { assignmentsToLose, authErrorCode, reconcileAssignmentsForRole } from '../_shared/users.ts'

interface UpdateUserRequest {
  user_id: string
  full_name?: string
  phone?: string
  email?: string
  password?: string
  role?: 'event_admin' | 'operator'
  event_id: string
  branch_ids?: string[]
  confirm_loss?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: UpdateUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }
  if (!body.user_id || !body.event_id) return json({ ok: false, error: 'invalid_body' }, 400)
  if (body.password !== undefined && body.password !== '' && body.password.length < 8) {
    return json({ ok: false, error: 'password_too_short' }, 400)
  }
  const wantedRole = body.role ?? null
  if (wantedRole && wantedRole !== 'event_admin' && wantedRole !== 'operator') {
    return json({ ok: false, error: 'invalid_role' }, 400)
  }

  const { data: profileData, error: profErr } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', body.user_id)
    .maybeSingle()
  if (profErr || !profileData) return json({ ok: false, error: 'user_not_found' }, 404)
  if (profileData.role === 'super_admin') return json({ ok: false, error: 'cannot_edit_super_admin' }, 403)

  const currentRole: 'event_admin' | 'operator' = profileData.role
  const targetRole = wantedRole ?? currentRole

  if (targetRole !== currentRole) {
    const loss = await assignmentsToLose(adminClient, body.user_id, currentRole, targetRole)
    if (loss.length > 0 && !body.confirm_loss) {
      return json({ ok: false, error: 'confirm_assignment_loss', assignments: loss }, 409)
    }
  }

  try {
    const authUpdates: { email?: string; password?: string } = {}
    const { data: currentAuth } = await adminClient.auth.admin.getUserById(body.user_id)
    const currentEmail = currentAuth?.user?.email ?? ''
    if (body.email && body.email.trim().toLowerCase() !== currentEmail.toLowerCase()) {
      authUpdates.email = body.email.trim().toLowerCase()
    }
    if (body.password && body.password !== '') authUpdates.password = body.password
    if (Object.keys(authUpdates).length > 0) {
      const { error: authErr } = await adminClient.auth.admin.updateUserById(body.user_id, authUpdates)
      if (authErr) return json({ ok: false, error: authErrorCode(authErr) }, 409)
    }

    const profileUpdate: { full_name?: string | null; phone?: string | null; role?: 'event_admin' | 'operator' } = {}
    if (body.full_name !== undefined) profileUpdate.full_name = body.full_name.trim() || null
    if (body.phone !== undefined) profileUpdate.phone = body.phone.trim() || null
    if (body.role !== undefined) profileUpdate.role = body.role
    if (Object.keys(profileUpdate).length > 0) {
      const { error: updErr } = await adminClient.from('profiles').update(profileUpdate).eq('id', body.user_id)
      if (updErr) throw updErr
    }

    await reconcileAssignmentsForRole(adminClient, body.user_id, body.event_id, targetRole, body.branch_ids ?? [])
  } catch (e) {
    console.error('update-user error', e)
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json({ ok: true, user_id: body.user_id }, 200)
})
```

- [ ] **Step 2: Verificación**

Revisión visual. Confirmar: la 409 con `assignments` llega intacta al frontend (patrón `error.context.json()`); el guard que bloquea editar super_admins evita lock-out.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/update-user/index.ts
git commit -m "feat: update-user edge function (profile/email/password/role, atomic)"
```

---

### Task 6: Edge Function `delete-user`

**Files:**
- Create: `supabase/functions/delete-user/index.ts`

**Interfaces:**
- Consumes: `authenticateSuperAdmin` + `authErrorCode` (Task 2).
- Produces: 200 `{ ok: true, user_id }` o error. La consume `deleteUser()` de Task 6.

- [ ] **Step 1: Crear la función**

```ts
import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import { authErrorCode } from '../_shared/users.ts'

interface DeleteUserRequest {
  user_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: DeleteUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }
  if (!body.user_id) return json({ ok: false, error: 'invalid_body' }, 400)

  const { data: profileData } = await adminClient.from('profiles').select('role').eq('id', body.user_id).maybeSingle()
  if (profileData?.role === 'super_admin') return json({ ok: false, error: 'cannot_delete_super_admin' }, 403)

  const { error } = await adminClient.auth.admin.deleteUser(body.user_id)
  if (error) return json({ ok: false, error: authErrorCode(error) }, 409)

  return json({ ok: true, user_id: body.user_id }, 200)
})
```

- [ ] **Step 2: Verificación**

Revisión visual. Confirmar: el guard contra super_admin; el `ON DELETE CASCADE` de 0001/0004 borra profiles/event_admins/branch_members.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/delete-user/index.ts
git commit -m "feat: delete-user edge function (hard delete, super_admin only)"
```

---

### Task 7: `useEvent` con `org_id` + consultas de Staff

**Files:**
- Modify: `src/hooks/useEvent.ts:30-36`
- Create: `src/pages/admin/staff/api.ts`

**Interfaces:**
- Consumes: `supabase.functions.invoke`, `FunctionsHttpError` del client, `supabase` client.
- Produces: el contrato de `api.ts` (ver File Structure) + tipos de fila de Staff (exportados desde `api.ts`):

```ts
export type StaffRole = 'super_admin' | 'event_admin' | 'operator'
export interface StaffUserAssignment {
  branch_id: string | null
  branch_name: string | null
}
export interface StaffUserRow {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: StaffRole
  assignments: StaffUserAssignment[]
}
```

**Importante:** `StaffUserAssignment` con `branch_id` y `branch_name` se define aquí en `api.ts`; Tasks 11 y 12 importan `StaffUserRow` de `./api`.

- [ ] **Step 1: Añadir `org_id` al select de `useEvent`**

En `src/hooks/useEvent.ts`, cambiar la línea 32:

```ts
      .select('id, slug, name, status, device_type, brand_primary, brand_secondary, logo_url, currency')
```

por:

```ts
      .select('id, slug, name, status, device_type, brand_primary, brand_secondary, logo_url, currency, org_id')
```

y añadir `org_id: string | null` al interface `EventRow`.

- [ ] **Step 2: Crear `src/pages/admin/staff/api.ts`**

```ts
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../../lib/supabase'

export type ManageRole = 'event_admin' | 'operator'

export interface CreateUserInput {
  email: string
  password?: string
  full_name?: string
  phone?: string
  role: ManageRole
  event_id: string
  branch_ids?: string[]
}

export interface InviteUserInput {
  email: string
  full_name?: string
  role: ManageRole
  event_id: string
  branch_ids?: string[]
}

export interface UpdateUserInput {
  user_id: string
  full_name?: string
  phone?: string
  email?: string
  password?: string
  role?: ManageRole
  event_id: string
  branch_ids?: string[]
  confirm_loss?: boolean
}

export class UserApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly payload: unknown = null,
  ) {
    super(message)
    this.name = 'UserApiError'
  }
}

export type StaffRole = 'super_admin' | 'event_admin' | 'operator'
export interface StaffUserAssignment {
  branch_id: string | null
  branch_name: string | null
}
export interface StaffUserRow {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: StaffRole
  assignments: StaffUserAssignment[]
}

interface InvokeResult {
  ok?: boolean
  error?: string
  [k: string]: unknown
}

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<InvokeResult>(fn, { body })
  if (error) {
    let code: string | null = null
    let payload: unknown = null
    if (error instanceof FunctionsHttpError) {
      const parsed = (await error.context.json().catch(() => null)) as InvokeResult | null
      code = parsed?.error ?? null
      payload = parsed
    }
    throw new UserApiError(code ?? 'Error de conexión — intenta de nuevo.', code, payload)
  }
  if (!data || data.ok === false) {
    throw new UserApiError(data?.error ?? 'Error desconocido.', data?.error ?? null, data ?? null)
  }
  return data as unknown as T
}

export function createUser(input: CreateUserInput) {
  return invoke<{ ok: true; user_id: string; generated_password?: string }>('create-user', input)
}
export function inviteUser(input: InviteUserInput) {
  return invoke<{ ok: true; user_id: string }>('invite-user', input)
}
export function updateUser(input: UpdateUserInput) {
  return invoke<{ ok: true; user_id: string }>('update-user', input)
}
export function deleteUser(user_id: string) {
  return invoke<{ ok: true }>('delete-user', { user_id })
}
```

- [ ] **Step 3: Verificación**

Run: `npm run build`
Expected: compila sin errores (tsc + vite).

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useEvent.ts src/pages/admin/staff/api.ts
git commit -m "feat: staff users api layer + event org_id"
```

---

### Task 8: Shell de modal + diálogo de confirmación

**Files:**
- Create: `src/pages/admin/staff/Modal.tsx`
- Create: `src/pages/admin/staff/ConfirmDialog.tsx`

**Interfaces:**
- Consumes: clases de `index.css` (`.card`, `.btn`, `.input`, `.cta-solid`, `.cta-coral`, `.field`).
- Produces: `Modal({ title, onClose, children })` y `ConfirmDialog({ title, message, items?, confirmLabel?, cancelLabel?, danger?, busy?, onConfirm, onCancel })` para Tasks 9-12.

- [ ] **Step 1: Crear `Modal.tsx`**

```tsx
import type { ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Crear `ConfirmDialog.tsx`**

```tsx
import Modal from './Modal'

export default function ConfirmDialog({
  title,
  message,
  items = [],
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  items?: string[]
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-ink-soft">{message}</p>
      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item} className="chip">
              {item}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'cta-coral max-w-[180px] text-sm' : 'cta-solid max-w-[180px] text-sm'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Verificación**

Run: `npm run build`; Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/staff/Modal.tsx src/pages/admin/staff/ConfirmDialog.tsx
git commit -m "feat: modal shell and confirm dialog"
```

---

### Task 9: `CreateUserModal` (flujo 2 pasos)

**Files:**
- Create: `src/pages/admin/staff/CreateUserModal.tsx`

**Interfaces:**
- Consumes: `Modal` (Task 8), `api/createUser`, `ManageRole` (Task 7), prop `branches: { id: string; name: string; type: string }[]` y `eventId: string` desde Staff.
- Produces: `CreateUserModal({ eventId, branches, onClose, onSuccess })`.

- [ ] **Step 1: Crear el componente**

```tsx
import { useState } from 'react'
import Modal from './Modal'
import { createUser, type ManageRole, type UserApiError } from './api'

const ROLE_LABEL: Record<ManageRole, string> = {
  event_admin: 'Admin del evento',
  operator: 'Operador',
}

export default function CreateUserModal({
  eventId,
  branches,
  onClose,
  onSuccess,
}: {
  eventId: string
  branches: { id: string; name: string; type: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [autoPassword, setAutoPassword] = useState(true)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<ManageRole>('operator')
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const res = await createUser({
        email,
        password: autoPassword ? undefined : password,
        full_name: fullName,
        phone: phone || undefined,
        role,
        event_id: eventId,
        branch_ids: role === 'operator' ? branchIds : undefined,
      })
      if (res.generated_password) setCreatedPassword(res.generated_password)
      setDone(true)
    } catch (e) {
      setError((e as UserApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title="Usuario creado" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          {email} ya puede iniciar sesión{createdPassword && ' con la contraseña temporal indicada abajo.'}
        </p>
        {createdPassword && (
          <div className="mt-4 rounded-2xl border-[1.5px] border-line bg-lilac p-4">
            <p className="text-xs font-bold text-ink-soft">Contraseña temporal (no se vuelve a mostrar)</p>
            <p className="font-mono text-lg font-bold text-violet">{createdPassword}</p>
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <button type="button" className="cta-solid max-w-[180px] text-sm" onClick={onSuccess}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={step === 1 ? 'Crear usuario' : 'Asignar sucursales'} onClose={onClose}>
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label>Teléfono (opcional)</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as ManageRole)}>
              <option value="operator">Operador</option>
              <option value="event_admin">Admin del evento</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
            <input
              type="checkbox"
              checked={autoPassword}
              onChange={(e) => setAutoPassword(e.target.checked)}
              className="h-4 w-4"
            />
            Generar contraseña automáticamente
          </label>
          {!autoPassword && (
            <div className="field">
              <label>Contraseña</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={busy || !email || (!autoPassword && password.length < 8)}
              onClick={() => setStep(2)}
            >
              Continuar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {role === 'operator' ? (
            <>
              <p className="text-sm text-ink-soft">Elige las sucursales para este operador.</p>
              <div className="flex flex-col gap-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm font-bold text-ink-soft">
                    <input
                      type="checkbox"
                      checked={branchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="h-4 w-4"
                    />
                    {b.name}
                  </label>
                ))}
                {branches.length === 0 && <p className="text-sm text-ink-faint">Este evento no tiene sucursales.</p>}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Se asignará como administrador de este evento.</p>
          )}
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy}>
              Volver
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              {busy ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: Verificación**

Run: `npm run build`; Run: `npm run lint`
Expected: sin errores. (Reload de la app → debug visual al final.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/staff/CreateUserModal.tsx
git commit -m "feat: create-user modal with generated-password + branch step"
```

---

### Task 10: `InviteUserModal` (flujo 2 pasos)

**Files:**
- Create: `src/pages/admin/staff/InviteUserModal.tsx`

**Interfaces:**
- Consumes: `Modal`, `api/inviteUser`, `ManageRole`; props `eventId`, `branches`, `onClose`, `onSuccess`.

- [ ] **Step 1: Crear el componente**

```tsx
import { useState } from 'react'
import Modal from './Modal'
import { inviteUser, type ManageRole, type UserApiError } from './api'

export default function InviteUserModal({
  eventId,
  branches,
  onClose,
  onSuccess,
}: {
  eventId: string
  branches: { id: string; name: string; type: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<ManageRole>('operator')
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      await inviteUser({
        email,
        full_name: fullName || undefined,
        role,
        event_id: eventId,
        branch_ids: role === 'operator' ? branchIds : undefined,
      })
      setDone(true)
    } catch (e) {
      setError((e as UserApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title="Invitación enviada" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          Se envió una invitación a {email}. Al aceptarla, el usuario ya tendrá su rol y asignaciones listos.
        </p>
        <div className="mt-5 flex justify-end">
          <button type="button" className="cta-solid max-w-[180px] text-sm" onClick={onSuccess}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={step === 1 ? 'Invitar por email' : 'Asignar sucursales'} onClose={onClose}>
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as ManageRole)}>
              <option value="operator">Operador</option>
              <option value="event_admin">Admin del evento</option>
            </select>
          </div>
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={!email}
              onClick={() => setStep(2)}
            >
              Continuar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {role === 'operator' ? (
            <>
              <p className="text-sm text-ink-soft">Elige las sucursales para este operador.</p>
              <div className="flex flex-col gap-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm font-bold text-ink-soft">
                    <input
                      type="checkbox"
                      checked={branchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="h-4 w-4"
                    />
                    {b.name}
                  </label>
                ))}
                {branches.length === 0 && <p className="text-sm text-ink-faint">Este evento no tiene sucursales.</p>}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Se asignará como administrador de este evento.</p>
          )}
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy}>
              Volver
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              {busy ? 'Enviando…' : 'Enviar invitación'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: Verificación**

Run: `npm run build`; Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/staff/InviteUserModal.tsx
git commit -m "feat: invite-user modal (role + branch assignment)"
```

---

### Task 11: `EditUserModal` (perfil + rol con confirmación de pérdida)

**Files:**
- Create: `src/pages/admin/staff/EditUserModal.tsx`

**Interfaces:**
- Consumes: `Modal`, `ConfirmDialog`, `api/updateUser`, `ManageRole`, `UserApiError`, tipo `StaffUserRow` (Task 7).
- Produces: `EditUserModal({ user, eventId, branches, onClose, onSuccess })` donde `user: StaffUserRow`.

- [ ] **Step 1: Crear el componente**

```tsx
import { useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { updateUser, type ManageRole, type StaffUserRow, type UserApiError } from './api'
```

```tsx
export default function EditUserModal({
  user,
  eventId,
  branches,
  onClose,
  onSuccess,
}: {
  user: StaffUserRow
  eventId: string
  branches: { id: string; name: string; type: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [fullName, setFullName] = useState(user.full_name ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<ManageRole>(user.role === 'event_admin' ? 'event_admin' : 'operator')
  const [branchIds, setBranchIds] = useState<string[]>(
    user.assignments.map((a) => a.branch_id).filter((b): b is string => Boolean(b)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLoss, setConfirmLoss] = useState<{ items: string[] } | null>(null)

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  async function handleSubmit(withConfirm = false) {
    setBusy(true)
    setError(null)
    try {
      await updateUser({
        user_id: user.id,
        full_name: fullName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        password: password || undefined,
        role,
        event_id: eventId,
        branch_ids: role === 'operator' ? branchIds : undefined,
        confirm_loss: withConfirm,
      })
      onSuccess()
    } catch (e) {
      const err = e as UserApiError
      if (err.code === 'confirm_assignment_loss') {
        const payload = err.payload as { assignments?: string[] } | null
        setConfirmLoss({ items: payload?.assignments ?? [] })
        setError(null)
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (confirmLoss) {
    return (
      <ConfirmDialog
        title="Cambio de rol"
        message="Este usuario tiene asignaciones que se perderán al cambiar de rol:"
        items={confirmLoss.items}
        confirmLabel="Cambiar rol"
        busy={busy}
        onConfirm={() => void handleSubmit(true)}
        onCancel={() => setConfirmLoss(null)}
      />
    )
  }

  return (
    <Modal title="Editar usuario" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="field">
          <label>Teléfono</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Contraseña (dejar vacío = no cambia)</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Rol</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as ManageRole)}>
            <option value="operator">Operador</option>
            <option value="event_admin">Admin del evento</option>
          </select>
        </div>
        {role === 'operator' ? (
          <div className="field">
            <label>Sucursales</label>
            <div className="flex flex-col gap-2">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm font-bold text-ink-soft">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    className="h-4 w-4"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-soft">Se mantiene como administrador de este evento.</p>
        )}
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="cta-solid max-w-[180px] text-sm"
            disabled={busy}
            onClick={() => void handleSubmit(false)}
          >
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Verificación**

Run: `npm run build`; Run: `npm run lint`
Expected: sin errores (ajustar el import de `StaffUserRow` a la ruta que resulte en Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/staff/EditUserModal.tsx
git commit -m "feat: edit-user modal with role-change warning"
```

---

### Task 12: `UserTable` (tabla presentacional)

**Files:**
- Create: `src/pages/admin/staff/UserTable.tsx`

**Interfaces:**
- Consumes: `StaffUserRow`, `ManageRole`.
- Produces: `UserTable({ rows, canManage, onEdit, onDelete })`.

- [ ] **Step 1: Crear el componente**

```tsx
import type { StaffUserRow, ManageRole } from './api'

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  event_admin: 'Admin del evento',
  operator: 'Operador',
}

export default function UserTable({
  rows,
  canManage,
  onEdit,
  onDelete,
}: {
  rows: StaffUserRow[]
  canManage: boolean
  onEdit: (user: StaffUserRow) => void
  onDelete: (user: StaffUserRow) => void
}) {
  return (
    <div className="table-card mt-5">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Asignaciones</th>
            {canManage && <th className="text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={canManage ? 5 : 4} className="text-ink-faint">
                Sin usuarios para esta vista.
              </td>
            </tr>
          )}
          {rows.map((u) => (
            <tr key={u.id}>
              <td>
                <div className="flex items-center gap-2">
                  <span className="avatar">{u.full_name?.trim().charAt(0).toUpperCase() ?? '?'}</span>
                  <span className="font-semibold">{u.full_name ?? 'Sin nombre'}</span>
                </div>
              </td>
              <td className="text-xs">{u.email || '—'}</td>
              <td>
                <span className="pill pill-mute">{ROLE_LABEL[u.role] ?? u.role}</span>
              </td>
              <td className="text-xs text-ink-soft">
                {u.role === 'operator'
                  ? u.assignments.length > 0
                    ? u.assignments.map((a) => a.branch_name).filter(Boolean).join(', ')
                    : 'Sin asignar'
                  : 'Este evento'}
              </td>
              {canManage && (
                <td className="text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      className="text-xs font-bold text-violet underline underline-offset-2 hover:text-violet-deep"
                      onClick={() => onEdit(u)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-xs font-bold text-rust underline underline-offset-2 hover:text-rust-fill"
                      onClick={() => onDelete(u)}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Verificación**

Run: `npm run build`; Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/staff/UserTable.tsx
git commit -m "feat: staff users table"
```

---

### Task 13: Reescritura de `Staff.tsx` (tabs + búsqueda + acciones)

**Files:**
- Rewrite: `src/pages/admin/Staff.tsx`

**Interfaces:**
- Consumes: `useEvent`, `useSessionRole`, `useQuery`/`useQueryClient`, `supabase` (consulta `staff_users`), modales Tasks 9-12, `UserTable` Task 12.
- Produces: la pantalla `admin/staff` funcional end-to-end.

- [ ] **Step 1: Reescribir `Staff.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { useSessionRole } from '../../hooks/useSessionRole'
import { supabase } from '../../lib/supabase'
import UserTable from './staff/UserTable'
import CreateUserModal from './staff/CreateUserModal'
import InviteUserModal from './staff/InviteUserModal'
import EditUserModal from './staff/EditUserModal'
import ConfirmDialog from './staff/ConfirmDialog'
import { deleteUser, type UserApiError } from './staff/api'
import type { StaffUserRow } from './staff/api'

type Tab = 'all' | 'admins' | 'operators'

interface AdminBridge {
  profile_id: string
}
interface MemberBridge {
  profile: { id: string }
  branch: { id: string; name: string } | null
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'admins', label: 'Admins' },
  { value: 'operators', label: 'Operadores' },
]

export default function Staff() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const role = useSessionRole()
  const isSuperAdmin = role === 'super_admin'
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState<'none' | 'manual' | 'invite'>('none')
  const [editing, setEditing] = useState<StaffUserRow | null>(null)
  const [deleting, setDeleting] = useState<StaffUserRow | null>(null)
  const [mutError, setMutError] = useState<string | null>(null)
  const [mutBusy, setMutBusy] = useState(false)

  const { data: users, isPending } = useQuery({
    queryKey: ['admin-staff-users', eventId, isSuperAdmin],
    enabled: Boolean(eventId),
    queryFn: async () => {
      let q = supabase.from('staff_users').select('id, org_id, email, full_name, phone, role')
      if (isSuperAdmin && event?.org_id) q = q.eq('org_id', event.org_id)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Pick<StaffUserRow, 'id' | 'email' | 'full_name' | 'phone' | 'role'>[]
    },
  })

  const { data: admins } = useQuery({
    queryKey: ['admin-staff-admins', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_admins')
        .select('user_id')
        .eq('event_id', eventId!)
      if (error) throw error
      return (data ?? []) as unknown as AdminBridge[]
    },
  })

  const { data: branches } = useQuery({
    queryKey: ['admin-staff-branches', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, type')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as { id: string; name: string; type: string }[]
    },
  })

  const { data: members } = useQuery({
    queryKey: ['admin-staff-members', eventId],
    enabled: Boolean(eventId) && Boolean(branches?.length),
    queryFn: async () => {
      const branchIds = (branches ?? []).map((b) => b.id)
      const { data, error } = await supabase
        .from('branch_members')
        .select('profile(id), branch(id, name)')
        .in('branch_id', branchIds)
      if (error) throw error
      return (data ?? []) as unknown as MemberBridge[]
    },
  })

  const adminIds = useMemo(() => new Set((admins ?? []).map((a) => a.user_id as string)), [admins])
  const branchByUser = useMemo(() => {
    const map = new Map<string, { branch_id: string; branch_name: string }[]>()
    for (const m of members ?? []) {
      const userId = m.profile?.id
      if (!userId || !m.branch) continue
      const list = map.get(userId) ?? []
      list.push({ branch_id: m.branch.id, branch_name: m.branch.name })
      map.set(userId, list)
    }
    return map
  }, [members])

  const rows = useMemo<StaffUserRow[]>(() => {
    const all = (users ?? []).map((u) => {
      const assignments =
        u.role === 'operator' ? (branchByUser.get(u.id) ?? []) : adminIds.has(u.id) ? [{ branch_id: null, branch_name: null }] : []
      return { ...u, assignments }
    })
    const filtered = tab === 'all' ? all : all.filter((u) => (tab === 'admins' ? u.role === 'event_admin' : u.role === 'operator'))
    const q = search.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter((u) => (u.full_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, admins, members, branchByUser, tab, search])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-staff-users', eventId, isSuperAdmin] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-admins', eventId] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-members', eventId] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-branches', eventId] })
  }

  function closeModals() {
    setCreating('none')
    setEditing(null)
    setMutError(null)
  }

  async function handleDelete() {
    if (!deleting) return
    setMutBusy(true)
    setMutError(null)
    try {
      await deleteUser(deleting.id)
      setDeleting(null)
      refresh()
    } catch (e) {
      setMutError((e as UserApiError).message)
    } finally {
      setMutBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Personal</h1>
        <span className="font-mono text-xs text-ink-faint">{rows.length} personas</span>
      </div>

      {isSuperAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="cta-solid max-w-[200px] text-sm" onClick={() => setCreating('manual')}>
            Crear usuario
          </button>
          <button type="button" className="btn" onClick={() => setCreating('invite')}>
            Invitar por email
          </button>
          <input
            className="input max-w-[280px]"
            placeholder="Buscar por nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {!isSuperAdmin && (
        <input
          className="input mt-4 max-w-[280px]"
          placeholder="Buscar por nombre o email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="mt-5 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={tab === t.value ? 'pill pill-gold' : 'pill pill-mute'}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mutError && <p className="mt-3 text-sm text-rust">{mutError}</p>}
      {isPending && <p className="mt-4 text-sm text-ink-faint">Cargando…</p>}
      {!isPending && (
        <UserTable
          rows={rows}
          canManage={isSuperAdmin}
          onEdit={(u) => setEditing(u as StaffUserRow)}
          onDelete={(u) => setDeleting(u as StaffUserRow)}
        />
      )}

      {creating === 'manual' && eventId && branches && (
        <CreateUserModal
          eventId={eventId}
          branches={branches}
          onClose={closeModals}
          onSuccess={() => {
            closeModals()
            refresh()
          }}
        />
      )}
      {creating === 'invite' && eventId && branches && (
        <InviteUserModal
          eventId={eventId}
          branches={branches}
          onClose={closeModals}
          onSuccess={() => {
            closeModals()
            refresh()
          }}
        />
      )}
      {editing && eventId && branches && (
        <EditUserModal
          user={editing}
          eventId={eventId}
          branches={branches}
          onClose={closeModals}
          onSuccess={() => {
            closeModals()
            refresh()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Eliminar usuario"
          message={`¿Eliminar a ${deleting.full_name ?? deleting.email}? Esta acción es permanente.`}
          confirmLabel="Eliminar"
          danger
          busy={mutBusy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificación**

Run: `npm run build`; Run: `npm run lint`
Expected: sin errores. El componente ya no referencia `PersonCard` ni las queries antiguas de `admin-staff-operators`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/Staff.tsx
git commit -m "feat: staff page with tabs, search, and full user management (super_admin)"
```

---

### Task 14: Deploy + verificación end-to-end manual

**Files:**
- None (configuración remota).

**Interfaces:**
- Consumes: Todo lo anterior.

- [ ] **Step 1: Deploy de las Edge Functions**

Run: (en una máquina con Supabase CLI logueada al proyecto `lhvqpymbgkjyfdcryhzp`, o vía Dashboard)

```bash
supabase functions deploy create-user invite-user update-user delete-user
```

Expected: 4 funciones desplegadas. Si no hay CLI: crear cada función desde el Dashboard (Supabase → Edge Functions → New) pegando el contenido de cada `index.ts`.

- [ ] **Step 2: Aplicar migración 0013 (si no se hizo en Task 1)**

Pegar `0013_staff_users_view.sql` en el SQL Editor. Expected: vista creada.

- [ ] **Step 3: Smoke test de la función `update-user` (SQL Editor / curl)**

Run: `curl -X POST https://<ref>.supabase.co/functions/v1/update-user -H "Authorization: Bearer <TOKEN_SUPER_ADMIN>" -H "Content-Type: application/json" -d '{"user_id":"<id>","role":"event_admin","event_id":"00000000-0000-0000-0000-000000000002","branch_ids":[]}'`

Expected: 409 `{ "ok": false, "error": "confirm_assignment_loss", "assignments": [...] }` si el usuario es operator con sucursales; o 200 `{ ok: true }` si no pierde nada.

- [ ] **Step 4: Prueba manual en UI (login super_admin)**

- Crear usuario manual (contraseña generada): verificar que aparece en la tabla con su rol.
- Invitar por email: verificar que llega la invitación y el rol queda pre-configurado al aceptar.
- Editar rol con asignaciones: verificar el warning y la confirmación.
- Eliminar: confirmar diálogo destructivo y desaparición de la fila.
- Login con el usuario editado: confirmar que su JWT NO refleja el rol nuevo hasta re-login (nota conocida).

- [ ] **Step 5: Prueba manual en UI (login event_admin)**

Verificar: tabla legible, sin botones de crear/invitar/editar/eliminar.

- [ ] **Step 6: Actualizar memoria + HANDOFF**

Agregar a `HANDOFF.md` y al memory de la sesión: funciones nuevas, migración 0013, gotcha del JWT.

- [ ] **Step 7: Commit final**

```bash
git add -A
git commit -m "docs: handoff update for user management feature"
```

---

## Self-Review

**Spec coverage:**
- Alta manual (email+password+nombre+rol) → Task 3 + Task 9 ✅
- Invitación por email con rol/asignaciones → Task 4 + Task 10 ✅
- Edición completa (nombre/tel/email/pass/rol) → Task 5 + Task 11 ✅
- Cambio de rol atómico con warning de pérdida → Task 5 (409 confirm_assignment_loss) + Task 11 ✅
- Eliminación dura con confirmación → Task 6 + Task 13 ✅
- Confirmación en todas las operaciones → ConfirmDialog en Task 8 + usos en Tasks 9-13 ✅
- Solo super_admin gestiona; event_admin solo lectura → `canManage` en Task 12/13 + guard `authenticateSuperAdmin` ✅
- Tabs Todos/Admins/Operators + búsqueda → Task 13 ✅
- Columna email → vista 0013 (Task 1) + Task 12 ✅
- Contraseña auto/manual → checkbox en Task 9 ✅
- Tabla global → reúsa patrón `.table-card` (Task 12) ✅

**Placeholder scan:** el import de `StaffUserRow` en Task 11 se marca como "ajustar a lo que resulte en Task 7" y Task 12 aclara el tipo real — sin placeholders abiertos, se resolvieron con el tipo refinado del Task 12 (exportado desde `api.ts`). ✅

**Type consistency:** `ManageRole` ('event_admin' | 'operator') es consistente en `api.ts` (Task 7), modales (Tasks 9-11) y funciones. `StaffUserRow` exportado desde `api.ts` y usado en Tasks 11-13. `confirm_loss` presente en el contrato de Task 7 y Task 5. ✅

**Desviaciones vs spec:** el spec mencionaba "react-hook-form + zod, patrón existente" — no existe tal patrón en el código (el proyecto los tiene instalados pero sin uso); se sigue el patrón real de inputs controlados. Sin test runner en el repo: la verificación se hace con `npm run build` + `npm run lint` + pruebas manuales (Task 14), no unit tests.