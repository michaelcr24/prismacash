# Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar CRUD completo a Sucursales y Dispositivos del admin panel, y corregir el redirect del login para que super_admin entre a `/admin` en vez de kiosk.

**Architecture:** Backend directo vía `supabase.from()` (RLS de super_admin ya permite todo en `branches`/`devices`). Frontend usa el patrón de modales inline ya probado en Staff (`Modal.tsx` + `ConfirmDialog.tsx`). Las pantallas `Branches.tsx` y `Devices.tsx` se reescriben como tablas profesionales.

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind 4, Supabase JS client 2.115, TanStack Query 4, react-router-dom 7.

## Global Constraints

- No usar react-hook-form/zod: inputs controlados con `useState` (patrón del repo).
- No agregar Edge Functions para branches/devices — operaciones directas vía `supabase.from()`.
- No crear/editar/eliminar usuarios `super_admin` desde la UI (ya cubierto por Staff).
- Todos los textos en español (empresa = país hispanohablante, eventos en CRC).
- `npm run build` (tsc -b + vite) y `npm run lint` deben pasar limpios.
- Seguir el patrón de modales de `src/pages/admin/staff/` (`Modal.tsx`, `ConfirmDialog.tsx`).
- IDs de evento se resuelven con el hook `useEvent(eventSlug)` → `event?.id`.
- Worktree de trabajo: `C:\Users\mmaltes\Documents\Proyecto-user-management`, rama `feature/user-management`.

---

### Task 1: Fix login redirect para super_admin

**Files:**
- Modify: `src/pages/Login.tsx:46-74`
- Modify: `src/pages/admin/AdminLayout.tsx:13-16`

**Interfaces:**
- Consumes: `readClaims` de `src/lib/sessionRole.ts`, `supabase` de `src/lib/supabase.ts`, `useSessionRole` de `src/hooks/useSessionRole.ts`, `homePathForRole` de `src/lib/sessionRole.ts` (ya existentes).
- Produces: `AdminLayout` redirige a `/login` si el rol no es `super_admin`/`event_admin`. `Login` resuelve rol por `profiles` si el JWT no trae claims.

- [ ] **Step 1: Agregar fallback de rol en `Login.tsx`**

Reemplazar el bloque que lee `readClaims` y decide el redirect (líneas 46-74) por:

```tsx
    // El auth hook ya metió los claims (event_role, event_id) en el JWT.
    const claims = readClaims(authData.session)
    let role: SessionRole = claims?.role ?? null
    let eventId = claims?.eventId ?? null

    if (!role) {
      // Fallback: si el access token no trae claims (hook no configurado o
      // sesión vieja), resolvemos el rol desde la tabla profiles.
      const userId = authData.session.user.id
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, org_id')
        .eq('id', userId)
        .maybeSingle()
      role = profile?.role ?? null
    }

    if (!eventId) {
      // Fallback: super_admin no tiene evento asignado en el JWT; lo
      // resolvemos por slug del evento que escribió el usuario.
      const { data: ev } = await supabase
        .from('events')
        .select('id')
        .eq('slug', eventSlug)
        .maybeSingle()
      eventId = ev?.id ?? null
    }

    let branchTypes: string[] = []
    if (role === 'operator' && eventId && authData?.session?.user) {
      try {
        branchTypes = await resolveOperatorBranches(eventId, authData.session.user.id)
      } catch {
        branchTypes = []
      }
    }

    setLoading(false)

    if (role === 'super_admin' && !eventId) {
      setError('No se pudo resolver el evento. Verifica el slug.')
      return
    }
    navigate(homePathForRole(role, eventSlug, branchTypes))
```

- [ ] **Step 2: Agregar guard de rol en `AdminLayout.tsx`**

Reemplazar el cuerpo del componente (líneas 14-16) por:

```tsx
export default function AdminLayout() {
  const { eventSlug } = useParams()
  const role = useSessionRole()

  if (role !== 'super_admin' && role !== 'event_admin') {
    return <Navigate to="/login" replace />
  }
```

Y en el import (línea 1), agregar `Navigate`:

```tsx
import { Link, Navigate, NavLink, Outlet, useParams } from 'react-router-dom'
```

- [ ] **Step 3: Verificar compilación**

Run: `npm run build`
Expected: `tsc -b` sin errores y vite build completo (`.js` chunks listos).

- [ ] **Step 4: Verificar lint**

Run: `npm run lint`
Expected: sin errores ni warnings.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Login.tsx src/pages/admin/AdminLayout.tsx
git commit -m "fix: login redirige super_admin a admin panel; guard de rol en AdminLayout"
```

---

### Task 2: Modales de Sucursales (CreateBranchModal)

**Files:**
- Create: `src/pages/admin/branches/CreateBranchModal.tsx`
- Reuse: `src/pages/admin/staff/Modal.tsx`

**Interfaces:**
- Consumes: `supabase` de `src/lib/supabase.ts`, `Modal` de `src/pages/admin/staff/Modal.tsx`.
- Produces: `CreateBranchModal({ eventId, onCreated, onClose })` — inserta en `branches` y llama `onCreated()` al terminar.

- [ ] **Step 1: Crear `src/pages/admin/branches/CreateBranchModal.tsx`**

```tsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../staff/Modal'

const TYPES = [
  { value: 'recharge_kiosk', label: 'Quiosco de recarga' },
  { value: 'sales_point', label: 'Punto de venta' },
  { value: 'both', label: 'Ambos' },
]

export default function CreateBranchModal({
  eventId,
  onCreated,
  onClose,
}: {
  eventId: string
  onCreated: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('sales_point')
  const [isActive, setIsActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('branches').insert({
      event_id: eventId,
      name: name.trim(),
      type,
      is_active: isActive,
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    onCreated()
    onClose()
  }

  return (
    <Modal title="Nueva sucursal" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Nombre</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Ej: Entrada norte"
          />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activa
        </label>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Creando…' : 'Crear sucursal'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/branches/CreateBranchModal.tsx
git commit -m "feat: modal creación de sucursal"
```

---

### Task 3: Modales de Sucursales (EditBranchModal + ConfirmDeleteDialog)

**Files:**
- Create: `src/pages/admin/branches/EditBranchModal.tsx`
- Create: `src/pages/admin/branches/ConfirmDeleteDialog.tsx`
- Reuse: `src/pages/admin/staff/Modal.tsx`, `src/pages/admin/staff/ConfirmDialog.tsx`

**Interfaces:**
- Consumes: `supabase`, `Modal`, `ConfirmDialog`, el tipo `BranchRow` definido en `Branches.tsx`.
- Produces: `EditBranchModal({ branch, onUpdated, onClose })`, `ConfirmDeleteDialog({ branch, terminalCount, onDeleted, onClose })`.

- [ ] **Step 1: Crear `src/pages/admin/branches/EditBranchModal.tsx`**

```tsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../staff/Modal'

const TYPES = [
  { value: 'recharge_kiosk', label: 'Quiosco de recarga' },
  { value: 'sales_point', label: 'Punto de venta' },
  { value: 'both', label: 'Ambos' },
]

export default function EditBranchModal({
  branch,
  onUpdated,
  onClose,
}: {
  branch: { id: string; name: string; type: string; is_active: boolean }
  onUpdated: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(branch.name)
  const [type, setType] = useState(branch.type)
  const [isActive, setIsActive] = useState(branch.is_active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('branches')
      .update({ name: name.trim(), type, is_active: isActive })
      .eq('id', branch.id)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onUpdated()
    onClose()
  }

  return (
    <Modal title="Editar sucursal" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activa
        </label>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Crear `src/pages/admin/branches/ConfirmDeleteDialog.tsx`**

```tsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import ConfirmDialog from '../staff/ConfirmDialog'

export default function ConfirmDeleteDialog({
  branch,
  terminalCount,
  onDeleted,
  onClose,
}: {
  branch: { id: string; name: string }
  terminalCount: number
  onDeleted: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items: string[] = []
  if (terminalCount > 0) items.push(`${terminalCount} terminal(es) asociada(s) se eliminarán también`)

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('branches').delete().eq('id', branch.id)
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    onDeleted()
    onClose()
  }

  return (
    <ConfirmDialog
      title="Eliminar sucursal"
      message={`¿Eliminar "${branch.name}"? Esta acción no se puede deshacer.`}
      items={items}
      confirmLabel="Eliminar"
      cancelLabel="Cancelar"
      danger
      busy={busy}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
    </ConfirmDialog>
  )
}
```

Nota: `ConfirmDialog` no acepta `children`. Para mostrar el error, agregar la prop `error?: string` a `ConfirmDialog.tsx` (ver Step 3) en vez de `children`.

- [ ] **Step 3: Agregar prop `error` a `ConfirmDialog.tsx`**

Modificar `src/pages/admin/staff/ConfirmDialog.tsx`:

```tsx
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  /* ... props existentes ... */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-ink-soft">{message}</p>
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
```

Y ajustar `ConfirmDeleteDialog` para pasar `error={error}` en vez de `children`:

```tsx
    <ConfirmDialog
      title="Eliminar sucursal"
      message={`¿Eliminar "${branch.name}"? Esta acción no se puede deshacer.`}
      items={items}
      confirmLabel="Eliminar"
      cancelLabel="Cancelar"
      danger
      busy={busy}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
```

- [ ] **Step 4: Verificar compilación**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/branches/EditBranchModal.tsx src/pages/admin/branches/ConfirmDeleteDialog.tsx src/pages/admin/staff/ConfirmDialog.tsx
git commit -m "feat: modal edición y confirmación de eliminación de sucursal"
```

---

### Task 4: Reescritura de Branches.tsx con tabla y CRUD

**Files:**
- Modify: `src/pages/admin/Branches.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `useQuery`/`useQueryClient` de TanStack, `useParams`, `useEvent`, `supabase`, `CreateBranchModal`, `EditBranchModal`, `ConfirmDeleteDialog`.
- Produces: pantalla con tabla de sucursales, botón "Nueva sucursal", acciones por fila (editar/eliminar), sección expandible de terminales.

- [ ] **Step 1: Reescribir `src/pages/admin/Branches.tsx`**

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEvent } from '../hooks/useEvent'
import { supabase } from '../lib/supabase'
import CreateBranchModal from './branches/CreateBranchModal'
import EditBranchModal from './branches/EditBranchModal'
import ConfirmDeleteDialog from './branches/ConfirmDeleteDialog'

interface BranchRow {
  id: string
  name: string
  type: string
  is_active: boolean
  created_at: string
  terminals: { id: string; device_label: string; is_active: boolean }[]
}

const TYPE_LABEL: Record<string, string> = {
  recharge_kiosk: 'Quiosco de recarga',
  sales_point: 'Punto de venta',
  both: 'Ambos',
}

function branchPill(active: boolean): string {
  return active ? 'pill pill-ok' : 'pill pill-mute'
}

export default function Branches() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const queryClient = useQueryClient()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BranchRow | null>(null)
  const [deleting, setDeleting] = useState<BranchRow | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: branches, isPending } = useQuery({
    queryKey: ['admin-branches', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, type, is_active, created_at, terminals(id, device_label, is_active)')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as BranchRow[]
    },
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-branches', eventId] })
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Sucursales</h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-faint">{branches?.length ?? 0} sucursales</span>
          <button className="cta-gold" onClick={() => setCreating(true)}>
            Nueva sucursal
          </button>
        </div>
      </div>

      <div className="table-card mt-5">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Terminales</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={5} className="text-ink-faint">Cargando…</td>
              </tr>
            )}
            {!isPending && branches?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-ink-faint">
                  Sin sucursales en este evento. Crea la primera.
                </td>
              </tr>
            )}
            {branches?.map((b) => (
              <>
                <tr key={b.id} onClick={() => setExpanded(expanded === b.id ? null : b.id)} className="cursor-pointer">
                  <td className="font-semibold">{b.name}</td>
                  <td>{TYPE_LABEL[b.type] ?? b.type}</td>
                  <td>
                    <span className={branchPill(b.is_active)}>{b.is_active ? 'Activa' : 'Inactiva'}</span>
                  </td>
                  <td className="font-mono text-xs">{b.terminals.length}</td>
                  <td className="text-right">
                    <button
                      className="btn mr-2"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(b)
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(b)
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
                {expanded === b.id && (
                  <tr key={`${b.id}-terminals`}>
                    <td colSpan={5}>
                      <div className="px-3 py-2">
                        {b.terminals.length === 0 && (
                          <p className="text-sm text-ink-faint">Sin terminales vinculadas.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {b.terminals.map((t) => (
                            <span key={t.id} className={`chip ${t.is_active ? '' : 'opacity-50'}`}>
                              {t.device_label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {creating && eventId && (
        <CreateBranchModal eventId={eventId} onCreated={refresh} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <EditBranchModal branch={editing} onUpdated={refresh} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          branch={deleting}
          terminalCount={deleting.terminals.length}
          onDeleted={refresh}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npm run build`
Expected: sin errores (ojo con el `Fragment` implícito `<>` dentro de `branches?.map` — agregar `key` en el Fragment con `React.Fragment key={b.id}` si tsc se queja).

- [ ] **Step 3: Verificar lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Prueba manual**

Run: `npm run dev` → `/e/demo/admin/branches` (super_admin). Probar:
1. Crear sucursal (se ve en la lista).
2. Editar nombre/tipo.
3. Eliminar con confirmación (warning si tiene terminales).
4. Click en fila expande terminales.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/Branches.tsx
git commit -m "feat: sucursales con tabla y CRUD completo"
```

---

### Task 5: Modales de Dispositivos (CreateDeviceModal)

**Files:**
- Create: `src/pages/admin/devices/CreateDeviceModal.tsx`
- Reuse: `src/pages/admin/staff/Modal.tsx`

**Interfaces:**
- Consumes: `supabase`, `Modal`, `useEvent` → `eventId`.
- Produces: `CreateDeviceModal({ eventId, onCreated, onClose })` — inserta en `devices` y crea `wallet` con balance 0.

- [ ] **Step 1: Crear `src/pages/admin/devices/CreateDeviceModal.tsx`**

```tsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../staff/Modal'

const KINDS = [
  { value: 'nfc', label: 'NFC' },
  { value: 'qr', label: 'QR' },
  { value: 'hybrid', label: 'Híbrido' },
]

export default function CreateDeviceModal({
  eventId,
  onCreated,
  onClose,
}: {
  eventId: string
  onCreated: () => void
  onClose: () => void
}) {
  const [uid, setUid] = useState('')
  const [type, setType] = useState('qr')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .insert({ event_id: eventId, uid: uid.trim(), type })
      .select('id')
      .single()
    if (deviceError) {
      setBusy(false)
      setError(deviceError.message)
      return
    }

    const { error: walletError } = await supabase.from('wallets').insert({ device_id: device.id, balance: 0 })
    setBusy(false)
    if (walletError) {
      setError(walletError.message)
      return
    }
    onCreated()
    onClose()
  }

  return (
    <Modal title="Nuevo dispositivo" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>UID</label>
          <input
            className="input"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            required
            placeholder="Ej: 04A3F2B1C9"
          />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Creando…' : 'Crear dispositivo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Verificar compilación**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/devices/CreateDeviceModal.tsx
git commit -m "feat: modal creación de dispositivo"
```

---

### Task 6: Modales de Dispositivos (EditDeviceModal + DeviceDetailModal)

**Files:**
- Create: `src/pages/admin/devices/EditDeviceModal.tsx`
- Create: `src/pages/admin/devices/DeviceDetailModal.tsx`
- Reuse: `src/pages/admin/staff/Modal.tsx`

**Interfaces:**
- Consumes: `supabase`, `Modal`, `useQuery` de TanStack para transacciones.
- Produces: `EditDeviceModal({ device, onUpdated, onClose })`, `DeviceDetailModal({ device, onClose })`.

- [ ] **Step 1: Crear `src/pages/admin/devices/EditDeviceModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../staff/Modal'

const KINDS = [
  { value: 'nfc', label: 'NFC' },
  { value: 'qr', label: 'QR' },
  { value: 'hybrid', label: 'Híbrido' },
]

const STATUSES = [
  { value: 'unassigned', label: 'Sin asignar' },
  { value: 'active', label: 'Activo' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'retired', label: 'Retirado' },
]

export default function EditDeviceModal({
  device,
  onUpdated,
  onClose,
}: {
  device: { id: string; uid: string; type: string; status: string }
  onUpdated: () => void
  onClose: () => void
}) {
  const [type, setType] = useState(device.type)
  const [status, setStatus] = useState(device.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('devices')
      .update({ type, status })
      .eq('id', device.id)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onUpdated()
    onClose()
  }

  return (
    <Modal title={`Editar dispositivo ${device.uid}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Estado</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Crear `src/pages/admin/devices/DeviceDetailModal.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import Modal from '../staff/Modal'

const TX_LABEL: Record<string, string> = {
  payment: 'Pago',
  topup: 'Recarga',
  initial_load: 'Recarga inicial',
  refund: 'Reembolso',
  migration_out: 'Migración salida',
  migration_in: 'Migración entrada',
  adjustment: 'Ajuste',
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n)
}

export default function DeviceDetailModal({
  device,
  onClose,
}: {
  device: {
    id: string
    uid: string
    type: string
    status: string
    assigned_at: string | null
    wallet?: { balance: number } | null
    attendee?: { full_name: string } | null
  }
  onClose: () => void
}) {
  const { data: txs } = useQuery({
    queryKey: ['device-txs', device.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('type, amount, balance_after, created_at')
        .eq('device_id', device.id)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as { type: string; amount: number; balance_after: number; created_at: string }[]
    },
  })

  const statusLabel: Record<string, string> = {
    unassigned: 'Sin asignar',
    active: 'Activo',
    blocked: 'Bloqueado',
    retired: 'Retirado',
  }

  return (
    <Modal title={`Dispositivo ${device.uid}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="cap text-ink-faint">Tipo</p>
            <p className="font-semibold uppercase">{device.type}</p>
          </div>
          <div>
            <p className="cap text-ink-faint">Estado</p>
            <p className="font-semibold">{statusLabel[device.status] ?? device.status}</p>
          </div>
          <div>
            <p className="cap text-ink-faint">Asistente</p>
            <p className="font-semibold">{device.attendee?.full_name ?? '—'}</p>
          </div>
          <div>
            <p className="cap text-ink-faint">Saldo</p>
            <p className="font-semibold">{formatMoney(device.wallet?.balance ?? 0)}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 font-mono text-[0.72rem] uppercase tracking-wider text-ink-faint">
            Transacciones recientes
          </p>
          {!txs && <p className="text-sm text-ink-faint">Cargando…</p>}
          {txs?.length === 0 && <p className="text-sm text-ink-faint">Sin transacciones.</p>}
          <div className="feed">
            {txs?.map((t) => (
              <div key={`${t.created_at}-${t.balance_after}`} className="feed-row">
                <span className="pill pill-mute">{TX_LABEL[t.type] ?? t.type}</span>
                <span className="amt pos">{formatMoney(Number(t.amount))}</span>
                <span className="time">
                  {new Date(t.created_at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/devices/EditDeviceModal.tsx src/pages/admin/devices/DeviceDetailModal.tsx
git commit -m "feat: modales edición y detalles de dispositivo"
```

---

### Task 7: Reescritura de Devices.tsx con tabla, CRUD y filtro por estado

**Files:**
- Modify: `src/pages/admin/Devices.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `useQuery`/`useQueryClient`, `useParams`, `useEvent`, `supabase`, `CreateDeviceModal`, `EditDeviceModal`, `DeviceDetailModal`, `ConfirmDialog` (del staff).
- Produces: tabla de dispositivos con filtro por estado, acciones editar/eliminar, click en fila abre detalles.

- [ ] **Step 1: Reescribir `src/pages/admin/Devices.tsx`**

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useEvent } from '../hooks/useEvent'
import { supabase } from '../lib/supabase'
import ConfirmDialog from './staff/ConfirmDialog'
import CreateDeviceModal from './devices/CreateDeviceModal'
import EditDeviceModal from './devices/EditDeviceModal'
import DeviceDetailModal from './devices/DeviceDetailModal'

interface DeviceRow {
  id: string
  uid: string
  type: string
  status: string
  assigned_at: string | null
  wallet: { balance: number } | null
  attendee: { full_name: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  unassigned: 'Sin asignar',
  active: 'Activo',
  blocked: 'Bloqueado',
  retired: 'Retirado',
}

const STATUS_PILL: Record<string, string> = {
  unassigned: 'pill-mute',
  active: 'pill-ok',
  blocked: 'pill-warn',
  retired: 'pill-gold',
}

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'unassigned', label: 'Sin asignar' },
  { value: 'active', label: 'Activos' },
  { value: 'blocked', label: 'Bloqueados' },
  { value: 'retired', label: 'Retirados' },
]

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n)
}

export default function Devices() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DeviceRow | null>(null)
  const [deleting, setDeleting] = useState<DeviceRow | null>(null)
  const [detail, setDetail] = useState<DeviceRow | null>(null)

  const { data: devices, isPending } = useQuery({
    queryKey: ['admin-devices', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('id, uid, type, status, assigned_at, wallet(balance), attendee(full_name)')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DeviceRow[]
    },
  })

  const visible = devices?.filter((d) => filter === 'all' || d.status === filter) ?? []

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-devices', eventId] })
  }

  async function handleDelete() {
    if (!deleting) return
    const { error } = await supabase.from('devices').delete().eq('id', deleting.id)
    if (error) return
    setDeleting(null)
    refresh()
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Dispositivos</h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-faint">{devices?.length ?? 0} registrados</span>
          <button className="cta-gold" onClick={() => setCreating(true)}>
            Nuevo dispositivo
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`btn ${filter === f.value ? 'btn-active' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="table-card mt-5">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>Asistente</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th className="text-right">Saldo</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={6} className="text-ink-faint">Cargando…</td>
              </tr>
            )}
            {!isPending && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="text-ink-faint">
                  Sin dispositivos en este evento.
                </td>
              </tr>
            )}
            {visible.map((d) => (
              <tr key={d.id} onClick={() => setDetail(d)} className="cursor-pointer">
                <td className="font-mono text-xs">{d.uid}</td>
                <td>{d.attendee?.full_name ?? '—'}</td>
                <td className="text-xs uppercase">{d.type}</td>
                <td>
                  <span className={STATUS_PILL[d.status] ?? 'pill-mute'}>{STATUS_LABEL[d.status] ?? d.status}</span>
                </td>
                <td className="text-right font-mono text-xs">{formatMoney(d.wallet?.balance ?? 0)}</td>
                <td className="text-right">
                  <button
                    className="btn mr-2"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(d)
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(d)
                    }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && eventId && (
        <CreateDeviceModal eventId={eventId} onCreated={refresh} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <EditDeviceModal device={editing} onUpdated={refresh} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Eliminar dispositivo"
          message={`¿Eliminar "${deleting.uid}"? Este dispositivo y su wallet se eliminarán permanentemente.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          danger
          busy={false}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
      {detail && <DeviceDetailModal device={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Agregar clase `btn-active` al CSS**

Modificar `src/index.css` (después del bloque `.btn:active` ~línea 141):

```css
  .btn-active {
    background: var(--color-ink);
    color: var(--color-paper);
  }
```

- [ ] **Step 3: Verificar compilación**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 4: Verificar lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 5: Prueba manual**

Run: `npm run dev` → `/e/demo/admin/devices` (super_admin). Probar:
1. Crear dispositivo (crea wallet con saldo 0).
2. Editar tipo/estado.
3. Eliminar con confirmación.
4. Filtro por estado funciona.
5. Click en fila abre detalles con transacciones.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/Devices.tsx src/index.css
git commit -m "feat: dispositivos con tabla, CRUD y filtro por estado"
```

---

### Task 8: Verificación final y merge a main

**Files:**
- No code changes (verificación).
- Modify: `docs/superpowers/plans/2026-09-10-admin-crud-design.md` → ya existe como spec; crear `HANDOFF.md` si no existe.

**Interfaces:**
- N/A (verificación final).

**Nota operativa**: el código vive en el worktree `Proyecto-user-management` (rama `feature/user-management`). Los cambios NO están en la carpeta principal `Proyecto` hasta el merge.

- [ ] **Step 1: Build y lint completos**

Run: `npm run build; npm run lint`
Expected: ambos sin errores.

- [ ] **Step 2: Verificación E2E en browser**

Probar como super_admin en `npm run dev`:
1. Login → redirige a `/admin` (Task 1).
2. `/e/demo/admin/branches` → crear/editar/eliminar sucursal, expandir terminales.
3. `/e/demo/admin/devices` → crear/editar/eliminar dispositivo, filtro, detalles.
4. `/e/demo/admin/staff` → sigue funcionando (el fix de `user(id)` no regresiona).

- [ ] **Step 3: Actualizar memoria del proyecto**

En `C:\Users\mmaltes\.claude\memory\prismacash.md`, agregar sección "Trabajo 2026-09-10 — Admin CRUD (sucursales + dispositivos)" con commits y lo pendiente.

- [ ] **Step 4: Merge de la rama `feature/user-management` → `main`**

Solicitar al usuario el merge (no ejecutar autónomamente).

---

## Self-Review

**Spec coverage:**
- Fix 1 (login redirect) → Task 1 ✓
- Fix 2 (Staff join query) → ya aplicado antes de este plan ✓
- Feature 1 (CRUD sucursales) → Tasks 2, 3, 4 ✓
- Feature 2 (CRUD dispositivos) → Tasks 5, 6, 7 ✓
- Verificación final → Task 8 ✓

**Placeholder scan:** Sin TBDs. Todos los pasos tienen código concreto. ✓

**Type consistency:**
- `CreateBranchModal` usada en Task 4 con `{ eventId, onCreated, onClose }` — definida en Task 2 ✓
- `EditBranchModal` con `{ branch, onUpdated, onClose }` — definida en Task 3 ✓
- `ConfirmDeleteDialog` con `{ branch, terminalCount, onDeleted, onClose }` — definida en Task 3 ✓
- `CreateDeviceModal` con `{ eventId, onCreated, onClose }` — definida en Task 5 ✓
- `EditDeviceModal` con `{ device, onUpdated, onClose }` — definida en Task 6 ✓
- `DeviceDetailModal` con `{ device, onClose }` — definida en Task 6 ✓
- `ConfirmDialog` con `error?` prop — Task 3 agrega la prop y Task 7 la usa ✓