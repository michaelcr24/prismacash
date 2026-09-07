# Navegación superadmin + asignación a sucursal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el superadmin salte entre dashboard, kiosk y pos desde la UI (solo su rol), y que el panel Personal pueda asociar/desasociar personas a sucursales (solo superadmin).

**Architecture:** Rol leído del JWT vía `readClaims` envuelto en un hook `useSessionRole()`. Enlaces de entrada en el sidebar de `AdminLayout` y vínculo de vuelta en el topbar de kiosk/pos, todos condicionados a `role === 'super_admin'`. La escritura de `branch_members` se habilita con una política RLS nueva; la mutación se hace desde `Staff.tsx` con react-query (invalidación de queries).

**Tech Stack:** React 19 + react-router-dom 7 + @tanstack/react-query 5 + Supabase (RLS/Postgres) + TypeScript + Tailwind v4.

## Global Constraints

- NO hay framework de tests en el repo (sin vitest/jest). El ciclo de verificación de cada task es `npm run build` (corre `tsc -b` + `vite build`) y `npm run lint` (`eslint .`).
- No añadir dependencias nuevas.
- Seguir los componentes CSS existentes: `.card`, `.field`, `.input`, `.pill pill-mute`, `.navlink`, `.cta-solid`, `.ui-topbar`.
- Copy de UI en español, consistente con el resto del panel.
- Tipos TS estrictos (los exige `tsc -b`).
- No añadir comentarios salvo JSDoc de cabecera cuando el archivo ya los usa (patrón Kiosk.tsx/Pos.tsx).
- La migración SQL debe seguir el patrón de numeración `supabase/migrations/00XX_*.sql`.

---

### Task 1: Hook `useSessionRole()`

**Files:**
- Create: `src/hooks/useSessionRole.ts`

**Interfaces:**
- Consumes: `useAuth()` de `src/lib/auth-context.ts` (contexto ya existente), `readClaims` y tipo `SessionRole` de `src/lib/sessionRole.ts`.
- Produces: `export function useSessionRole(): SessionRole` → devuelve `'super_admin' | 'event_admin' | 'operator' | null`. Lo consumen los Tasks 2, 3 y 5.

- [ ] **Step 1: Crear el hook**

```ts
import { useAuth } from '../lib/auth-context'
import { readClaims, type SessionRole } from '../lib/sessionRole'

/** Rol de la sesión desde los claims del JWT (ver sessionRole.ts). */
export function useSessionRole(): SessionRole {
  const { session } = useAuth()
  return readClaims(session)?.role ?? null
}
```

- [ ] **Step 2: Verificar build y lint**

Run: `npm run build`
Expected: compila sin errores (tsc + vite).

Run: `npm run lint`
Expected: sin errores de eslint.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSessionRole.ts
git commit -m "feat: add useSessionRole hook"
```

---

### Task 2: Sidebar del admin — enlaces a Kiosk y POS (solo superadmin)

**Files:**
- Modify: `src/pages/admin/AdminLayout.tsx`

**Interfaces:**
- Consumes: `useSessionRole()` (Task 1), `eventSlug` (ya vía `useParams`).
- Produces: rutas absolutas `/e/{eventSlug}/kiosk` y `/e/{eventSlug}/pos` visibles solo para `role === 'super_admin'`. Ninguna otra task depende de esto, pero Kiosk/POS de Task 3 enlazan de vuelta a `/e/{eventSlug}/admin`.

- [ ] **Step 1: Añadir imports**

Cambiar línea 1 de `src/pages/admin/AdminLayout.tsx`:

```tsx
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useSessionRole } from '../../hooks/useSessionRole'
```

- [ ] **Step 2: Leer el rol en el componente**

Dentro de `export default function AdminLayout()`:

```tsx
const { eventSlug } = useParams()
const role = useSessionRole()
```

- [ ] **Step 3: Añadir la sección "Pantallas operativas"**

Justo después del cierre del `{NAV.map(...)}` y antes de `</nav>` (dentro de `<nav ...>`):

```tsx
{role === 'super_admin' && (
  <div className="mt-4 flex flex-col gap-1 border-t border-line pt-4">
    <p className="px-2 pb-1 text-[0.68rem] font-bold uppercase tracking-[0.6px] text-ink-faint">
      Pantallas operativas
    </p>
    <Link to={`/e/${eventSlug}/kiosk`} className="navlink">
      <span className="n">K</span>
      Kiosk
    </Link>
    <Link to={`/e/${eventSlug}/pos`} className="navlink">
      <span className="n">P</span>
      Punto de venta
    </Link>
  </div>
)}
```

- [ ] **Step 4: Verificar build y lint**

Run: `npm run build` y `npm run lint`
Expected: ambos pasan.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/AdminLayout.tsx
git commit -m "feat: admin sidebar links to kiosk and pos for superadmin"
```

---

### Task 3: Vínculo de vuelta al dashboard en POS y Kiosk (solo superadmin)

**Files:**
- Modify: `src/pages/Pos.tsx`, `src/pages/Kiosk.tsx`

**Interfaces:**
- Consumes: `useSessionRole()` (Task 1), `eventSlug` (ya vía `useParams`).
- Produces: vínculo `<Link>` a `/e/{eventSlug}/admin` dentro del `<header className="ui-topbar">`, renderizado solo para superadmin.

- [ ] **Step 1: `Pos.tsx` — import Link**

Cambiar línea 2 de `src/pages/Pos.tsx`:

```tsx
import { Link, useParams } from 'react-router-dom'
```

Añadir debajo de `import { supabase } from '../lib/supabase'`:

```tsx
import { useSessionRole } from '../hooks/useSessionRole'
```

- [ ] **Step 2: `Pos.tsx` — back link en el topbar**

Dentro de la función `Pos`, junto a `const { eventSlug } = useParams()`:

```tsx
const role = useSessionRole()
```

Cambiar el `<header className="ui-topbar">` (líneas 86-95) añadiendo el link como primer hijo:

```tsx
<header className="ui-topbar">
  {role === 'super_admin' && (
    <Link to={`/e/${eventSlug}/admin`} className="text-xs font-bold uppercase tracking-wider text-ink-soft hover:text-violet">
      ← Dashboard
    </Link>
  )}
  <b>Punto de venta</b>
  <span>
    <span className="mr-3 font-normal normal-case">{event?.name ?? eventSlug}</span>
    <span className="ui-online">
      <span className="h-1.5 w-1.5 rounded-full bg-signal" />
      en línea
    </span>
  </span>
</header>
```

- [ ] **Step 3: `Kiosk.tsx` — import Link**

Cambiar línea 2 de `src/pages/Kiosk.tsx`:

```tsx
import { Link, useParams } from 'react-router-dom'
```

Añadir debajo de `import { supabase } from '../lib/supabase'`:

```tsx
import { useSessionRole } from '../hooks/useSessionRole'
```

- [ ] **Step 4: `Kiosk.tsx` — back link en el topbar**

Dentro de `Kiosk`, junto a `const { eventSlug } = useParams()`:

```tsx
const role = useSessionRole()
```

Cambiar el `<header className="ui-topbar">` (líneas 167-176) añadiendo el link como primer hijo:

```tsx
<header className="ui-topbar">
  {role === 'super_admin' && (
    <Link to={`/e/${eventSlug}/admin`} className="text-xs font-bold uppercase tracking-wider text-ink-soft hover:text-violet">
      ← Dashboard
    </Link>
  )}
  <b>Quiosco de recarga</b>
  <span>
    <span className="mr-3 font-normal normal-case">{event?.name ?? eventSlug}</span>
    <span className="ui-online">
      <span className="h-1.5 w-1.5 rounded-full bg-signal" />
      en línea
    </span>
  </span>
</header>
```

Nota: `.ui-topbar` es `flex items-center justify-between`; con 3 hijos (link, título, nombre) queda link a la izquierda, título al centro, evento a la derecha. Sin superadmin conserva el layout actual de 2 hijos.

- [ ] **Step 5: Verificar build y lint**

Run: `npm run build` y `npm run lint`
Expected: ambos pasan.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Pos.tsx src/pages/Kiosk.tsx
git commit -m "feat: back-to-dashboard link in kiosk and pos for superadmin"
```

---

### Task 4: Migración — RLS de escritura sobre `branch_members` para super_admin

**Files:**
- Create: `supabase/migrations/0012_super_admin_branch_members.sql`

**Interfaces:**
- Consumes: función `is_super_admin()` (ya definida en `0001_init.sql:176`), tabla `branch_members` con RLS habilitada (`0001_init.sql:189`).
- Produces: política `super_admin_all_branch_members` que habilita INSERT/DELETE/UPDATE/SELECT a superadmin vía cliente (PostgREST). La consume el Task 5.

- [ ] **Step 1: Crear la migración**

```sql
-- Super admin puede gestionar la membresía usuario↔sucursal desde el panel
-- admin (Staff). branch_members solo tenía políticas SELECT (0001/0011); sin
-- una política de escritura, PostgREST deniega el INSERT/DELETE a superadmin.
create policy super_admin_all_branch_members on branch_members
  for all using (is_super_admin()) with check (is_super_admin());
```

- [ ] **Step 2: Revisión + build intacto**

Run: `npm run build`
Expected: compila, el archivo SQL no afecta al cliente.

Verificación manual (no automatizable aquí): confirmar con el patrón de `super_admin_all_event_admins` en `0004_event_admins_and_auth_hook.sql:23` que la sintaxis es la del repo.

Nota: aplicar la migración al proyecto Supabase vinculado (`supabase db push`) o en el SQL Editor queda a criterio del usuario; el paso de despliegue no es parte de este plan.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_super_admin_branch_members.sql
git commit -m "feat: allow super_admin to write branch_members (RLS)"
```

---

### Task 5: Staff — "Asociar persona a sucursal" y "Quitar" (solo superadmin)

**Files:**
- Modify: `src/pages/admin/Staff.tsx`

**Interfaces:**
- Consumes: `useSessionRole()` (Task 1), la política RLS del Task 4, queries react-query existentes (`admin-staff-members`), patrón de `Branches.tsx:32-44` para leer sucursales.
- Produces: formulario que inserta en `branch_members` y botón que borra por `branch_members.id`; invalidación de `admin-staff-members` y `admin-staff-operators`. `event_admin` conserva vista de solo lectura (sin los controles).

- [ ] **Step 1: Importar lo necesario**

En `src/pages/admin/Staff.tsx`, añadir al inicio:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSessionRole } from '../../hooks/useSessionRole'
```

(La línea 1 del archivo ya tiene `import { useQuery } from '@tanstack/react-query'` — se sustituye por la versión con `useQueryClient`.)

Añadir después de `ROLE_LABEL`:

```tsx
const BRANCH_TYPE_LABEL: Record<string, string> = {
  recharge_kiosk: 'Quiosco de recarga',
  sales_point: 'Punto de venta',
  both: 'Ambos',
}

interface BranchOption {
  id: string
  name: string
  type: string
}

interface OperatorRow {
  id: string
  full_name: string | null
  phone: string | null
}
```

- [ ] **Step 2: Estado y queries de sucursales/operadores**

Dentro de `Staff()`, junto a los hooks existentes:

```tsx
const role = useSessionRole()
const queryClient = useQueryClient()
const isSuperAdmin = role === 'super_admin'

const [selectedBranchId, setSelectedBranchId] = useState('')
const [selectedUserId, setSelectedUserId] = useState('')
const [mutating, setMutating] = useState(false)
const [mutError, setMutError] = useState<string | null>(null)
```

Añadir tras la query `admin-staff-members`:

```tsx
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
    return (data ?? []) as BranchOption[]
  },
})

const { data: operators } = useQuery({
  queryKey: ['admin-staff-operators'],
  enabled: isSuperAdmin,
  queryFn: async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .eq('role', 'operator')
    if (error) throw error
    return (data ?? []) as OperatorRow[]
  },
})
```

- [ ] **Step 3: Handlers de asignar y quitar**

Añadir antes del `return` de `Staff()`:

```tsx
async function handleAssign(e: React.FormEvent) {
  e.preventDefault()
  if (!eventId || !selectedBranchId || !selectedUserId) return
  setMutating(true)
  setMutError(null)
  const { error } = await supabase
    .from('branch_members')
    .insert({ user_id: selectedUserId, branch_id: selectedBranchId })
  setMutating(false)
  if (error) {
    setMutError('No se pudo asignar: es posible que la persona ya esté en esa sucursal.')
    return
  }
  queryClient.invalidateQueries({ queryKey: ['admin-staff-members', eventId] })
  queryClient.invalidateQueries({ queryKey: ['admin-staff-operators'] })
  setSelectedUserId('')
}

async function handleRemove(memberId: string) {
  if (!eventId) return
  setMutating(true)
  setMutError(null)
  const { error } = await supabase.from('branch_members').delete().eq('id', memberId)
  setMutating(false)
  if (error) {
    setMutError('No se pudo quitar la asignación.')
    return
  }
  queryClient.invalidateQueries({ queryKey: ['admin-staff-members', eventId] })
}

const assignedUserIdsInBranch = new Set(
  (members ?? [])
    .filter((m) => m.branch?.id === selectedBranchId)
    .map((m) => m.profile?.id),
)
const availableOperators = (operators ?? []).filter((o) => !assignedUserIdsInBranch.has(o.id))
```

- [ ] **Step 4: Render del formulario de asignación (solo superadmin)**

Dentro del `return`, justo después del `<div className="mt-5 flex flex-col gap-3">` abierto y antes del `{pending && ...}`:

```tsx
{isSuperAdmin && (
  <form onSubmit={handleAssign} className="card flex flex-col gap-3 p-4">
    <p className="text-sm font-bold">Asociar persona a sucursal</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="field">
        <label>Sucursal</label>
        <select
          value={selectedBranchId}
          onChange={(e) => {
            setSelectedBranchId(e.target.value)
            setSelectedUserId('')
          }}
          className="input"
          required
        >
          <option value="">Selecciona…</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {BRANCH_TYPE_LABEL[b.type] ?? b.type}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Persona</label>
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="input"
          required
        >
          <option value="">Selecciona…</option>
          {availableOperators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name ?? o.phone ?? 'Sin nombre'}
            </option>
          ))}
        </select>
      </div>
    </div>
    {mutError && <p className="text-sm text-rust">{mutError}</p>}
    <button
      type="submit"
      disabled={!selectedBranchId || !selectedUserId || mutating}
      className="cta-solid disabled:opacity-50"
    >
      {mutating ? 'Asignando…' : 'Asignar'}
    </button>
  </form>
)}
```

- [ ] **Step 5: Botón "Quitar" en las tarjetas de miembros**

Actualizar el map de `members` (líneas 80-88) para pasar `onRemove` solo a superadmin:

```tsx
{members?.map((m) => (
  <PersonCard
    key={m.id}
    name={m.profile?.full_name ?? 'Sin nombre'}
    role={m.profile?.role ?? 'operator'}
    phone={m.profile?.phone}
    branch={m.branch?.name ?? '—'}
    onRemove={isSuperAdmin ? () => handleRemove(m.id) : undefined}
  />
))}
```

Actualizar la firma y el cuerpo de `PersonCard`:

```tsx
function PersonCard({
  name,
  role,
  phone,
  branch,
  onRemove,
}: {
  name: string
  role: string
  phone: string | null
  branch: string | null
  onRemove?: () => void
}) {
  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div>
        <p className="font-semibold">{name}</p>
        <p className="text-xs text-ink-soft">
          {phone ?? 'Sin teléfono'} {branch ? `· ${branch}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="pill pill-mute">{ROLE_LABEL[role] ?? role}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-ink-faint underline underline-offset-2 hover:text-rust"
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verificar build y lint**

Run: `npm run build` y `npm run lint`
Expected: ambos pasan. Revisar que no queden import sin usar (`Branches.tsx` referencia opcional; en Staff no hace falta).

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/Staff.tsx
git commit -m "feat: manage user-branch assignment in staff panel (superadmin)"
```

---

### Task 6: Verificación funcional manual del flujo completo

**Files:**
- Ninguno (verificación E2E manual en navegador).

**Interfaces:**
- Consumes: todas las tareas anteriores aplicadas.

- [ ] **Step 1: Aplicar la migración al proyecto**

Run: `supabase db push` (o pegar el SQL de `0012_super_admin_branch_members.sql` en el SQL Editor del dashboard).
Expected: la política queda creada (verificable con `supabase/seed.sql` o dashboard → Table Editor → RLS policies de `branch_members`).

- [ ] **Step 2: Login como superadmin**

Run: `npm run dev`, iniciar sesión con cuenta `super_admin` y el slug del evento.
Expected: aterriza en `/e/{slug}/admin`.

- [ ] **Step 3: Navegación entre pantallas**

En el sidebar del admin, la sección **Pantallas operativas** muestra Kiosk y Punto de venta; al hacer clic va a `/e/{slug}/kiosk` y `/e/{slug}/pos`. En cada una, el topbar muestra "← Dashboard" y regresa a `/e/{slug}/admin`.
Expected: la vuelta funciona y el estado de kiosk/pos se mantiene coherente (no se exige persistencia).

- [ ] **Step 4: Logout y login como event_admin**

Con una cuenta `event_admin`, la sección **Pantallas operativas** NO debe aparecer, ni el "← Dashboard" en kiosk/pos, ni los controles de "Asociar persona"/"Quitar" en Personal.
Expected: `event_admin` no ve ningún control de superadmin.

- [ ] **Step 5: Asignación en Personal (superadmin)**

En Admin → Personal, elegir sucursal + persona y dar "Asignar". La persona aparece en la lista con su sucursal. Luego "Quitar" y desaparece.
Expected: la lista se refresca sin recargar la página (invalidación de react-query).

---

## Notas

- El plan asume que `npm run build`/`npm run lint` son el ciclo de verificación (no hay infraestructura de tests en el repo).
- La restricción de rol es a nivel de UI (visibilidad de enlaces/controles); `RequireAuth` de `src/App.tsx:22` sigue validando solo sesión, lo que es coherente con el spec ("Fuera de alcance").
- El `branch_members` para kiosk/pos NO requiere que el superadmin sea miembro (charge/topup solo validan si el cliente envía `branch_id`, y no se envía).