# Events Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full CRUD for events in the admin panel, allowing super_admin to create, edit, delete, and open events — giving super_admin complete control over the platform for client demos.

**Architecture:** Follow the same direct-table pattern used for Branches and Devices CRUD (`supabase.from()` with RLS, no Edge Functions). Add a global Events page under admin, accessible only to super_admin, which lists all events with organization names and provides create/edit/delete modals. The page exists outside the current-event context since it shows all events across organizations.

**Tech Stack:** Vite 8 + React 19 + TypeScript + Tailwind 4 + Supabase client JS 2.115 + react-router-dom 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/pages/admin/Events.tsx` | Events list table (all events), "Nuevo evento" button, actions (Open/Edit/Delete) |
| `src/pages/admin/events/CreateEventModal.tsx` | Create event form: org selector, name, slug (auto from name), status, device_type, currency, brand colors |
| `src/pages/admin/events/EditEventModal.tsx` | Edit event form (pre-filled), same fields as create |
| `src/pages/admin/events/ConfirmDeleteEventDialog.tsx` | Delete confirmation with cascade warning |
| `src/pages/admin/AdminLayout.tsx` (modify) | Add "Eventos" nav item (super_admin only) |
| `src/App.tsx` (modify) | Add `events` route under admin routes |

---

## Global Constraints

- TypeScript strict mode (`tsc -b` must pass).
- No react-hook-form or zod — use controlled inputs with `useState`.
- Style: match existing admin pages — use the repo's CSS classes (`.field`, `.input`, `.btn`, `.cta-solid`, `.cta-gold`, `.cta-coral`, `.text-rust`, `.text-ink-faint`, `.pill`, `.table-card`, `.chip`) driven by the Tailwind design tokens. Follow the exact patterns in `src/pages/admin/branches/CreateBranchModal.tsx`, `branches/EditBranchModal.tsx`, `branches/ConfirmDeleteDialog.tsx`, `branches/Branches.tsx`, `staff/Modal.tsx`, `staff/ConfirmDialog.tsx`. Do NOT use raw Tailwind utility-only styling (e.g. `bg-red-50 text-red-700 rounded`) where a repo class exists.
- Embed pattern for org name: `.from('events').select('*, organizations!inner(name)')` — the FK name is `organizations` (plural), confirmed by PostgREST embed lesson.
- Postgres unique constraint on `events.slug` → handle error gracefully (show message).
- `events.org_id` is NOT NULL → org selector is required.
- Role gating: Events nav item and route only visible/accessible to `super_admin`.

---

## Task 1: Route + AdminLayout Nav

**Files:**
- Modify: `src/App.tsx:57-72` (admin children routes)
- Modify: `src/pages/admin/AdminLayout.tsx:4-11` (NAV array)

**Interfaces:**
- Consumes: `useSessionRole()` hook already imported in AdminLayout (returns `{ role }`).
- Produces: `events` path becomes available at `/e/:eventSlug/admin/events`; nav item "Eventos" shown only to super_admin.

- [ ] **Step 1: Add route in `src/App.tsx`**

Inside the `AdminLayout` children routes block (after the `refunds` route), add:

```tsx
// src/App.tsx — inside admin children, after refunds route
{
  path: 'events',
  element: <Events />,
},
```

Add the import at top of file:

```tsx
import Events from './pages/admin/Events';
```

- [ ] **Step 2: Add "Eventos" nav item to AdminLayout, gated to super_admin**

The NAV array uses `{ to, n, label }` where `n` is the badge number. Add an optional `superOnly?: true` flag to the events entry and filter before rendering:

```tsx
// src/pages/admin/AdminLayout.tsx — NAV array (insert after dashboard entry)
const NAV = [
  { to: 'dashboard', n: '01', label: 'Dashboard' },
  { to: 'events', n: '02', label: 'Eventos', superOnly: true },
  { to: 'branches', n: '03', label: 'Sucursales' },
  { to: 'staff', n: '04', label: 'Personal' },
  { to: 'devices', n: '05', label: 'Dispositivos' },
  { to: 'transactions', n: '06', label: 'Transacciones' },
  { to: 'refunds', n: '07', label: 'Reembolsos' },
]
```

Filter in the render loop before mapping:

```tsx
// AdminLayout.tsx — replace `{NAV.map((item) => (` with:
{NAV.filter((item) => !item.superOnly || role === 'super_admin').map((item) => (
  <NavLink key={item.to} to={item.to} className="navlink">
    <span className="n">{item.n}</span>
    {item.label}
  </NavLink>
))}
```

The existing `{role === 'super_admin' && (...) // Pantallas operativas}` block is untouched.

- [ ] **Step 3: Create skeleton `src/pages/admin/Events.tsx`**

Create the file with a minimal skeleton that loads events and renders a table:

```tsx
// src/pages/admin/Events.tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface EventRow {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  device_type: string;
  currency: string;
  brand_primary: string;
  brand_secondary: string;
  starts_at: string | null;
  ends_at: string | null;
  organizations: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activo',
  closed: 'Cerrado',
};

function statusPill(status: string): string {
  if (status === 'active') return 'pill pill-ok';
  if (status === 'draft') return 'pill pill-warn';
  return 'pill pill-mute';
}

const DEVICE_LABEL: Record<string, string> = {
  nfc: 'NFC',
  qr: 'QR',
  hybrid: 'Híbrido',
};

export default function Events() {
  const { data: events, isPending } = useQuery({
    queryKey: ['admin-all-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, org_id, name, slug, status, device_type, currency, brand_primary, brand_secondary, starts_at, ends_at, organizations!inner(name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      if (!data) return []
      return data as EventRow[]
    },
  })

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Eventos</h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-faint">{events?.length ?? 0} eventos</span>
          {/* "Nuevo evento" button added in Task 2 */}
        </div>
      </div>

      <div className="table-card mt-5">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Slug</th>
              <th>Estado</th>
              <th>Dispositivo</th>
              <th>Moneda</th>
              <th>Organización</th>
              <th>Inicio</th>
              <th>Cierre</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={9} className="text-ink-faint">Cargando…</td>
              </tr>
            )}
            {!isPending && events?.length === 0 && (
              <tr>
                <td colSpan={9} className="text-ink-faint">
                  No hay eventos. Crea el primero.
                </td>
              </tr>
            )}
            {events?.map((ev) => (
              <tr key={ev.id}>
                <td className="font-semibold">{ev.name}</td>
                <td className="font-mono text-xs">{ev.slug}</td>
                <td>
                  <span className={statusPill(ev.status)}>{STATUS_LABEL[ev.status] ?? ev.status}</span>
                </td>
                <td>{DEVICE_LABEL[ev.device_type] ?? ev.device_type}</td>
                <td className="font-mono text-xs">{ev.currency}</td>
                <td>{ev.organizations?.name ?? '—'}</td>
                <td className="text-xs">{ev.starts_at ? new Date(ev.starts_at).toLocaleDateString() : '—'}</td>
                <td className="text-xs">{ev.ends_at ? new Date(ev.ends_at).toLocaleDateString() : '—'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link className="btn mr-2" to={`/e/${ev.slug}/admin/dashboard`}>
                    Abrir
                  </Link>
                  <button className="btn mr-2">Editar</button>
                  <button className="btn">Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build` from project root.
Expected: build passes (tsc + vite build).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/admin/AdminLayout.tsx src/pages/admin/Events.tsx
git commit -m "feat: add events page route and skeleton (super_admin only)"
```

---

## Task 2: CreateEventModal

**Files:**
- Create: `src/pages/admin/events/CreateEventModal.tsx`
- Modify: `src/pages/admin/Events.tsx` (add "Nuevo evento" button, import modal)

**Interfaces:**
- Consumes: `supabase.from('organizations').select('id, name, slug')` (orgs list for selector).
- Produces: After successful insert, `Events.tsx` queries `admin-all-events` to refresh the table. Emits `onClose()` and `onCreated()` (which calls `queryClient.invalidateQueries(['admin-all-events'])`).

- [ ] **Step 1: Create `src/pages/admin/events/CreateEventModal.tsx`**

Follow the same pattern as `branches/CreateBranchModal.tsx`. Include org selector that fetches organizations on mount.

```tsx
// src/pages/admin/events/CreateEventModal.tsx
// STYLING: follow branches/CreateBranchModal.tsx exactly — use .field, .input,
// .btn, .cta-solid, .text-rust classes (NOT raw Tailwind utility classes).
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import Modal from '../staff/Modal';

interface Org { id: string; name: string; slug: string }

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

function slugify(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const STATUSES = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
  { value: 'closed', label: 'Cerrado' },
] as const;

const DEVICE_TYPES = [
  { value: 'qr', label: 'QR' },
  { value: 'nfc', label: 'NFC' },
  { value: 'hybrid', label: 'Híbrido' },
] as const;

export default function CreateEventModal({ onClose, onCreated }: Props) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState<'draft' | 'active' | 'closed'>('draft');
  const [deviceType, setDeviceType] = useState<'nfc' | 'qr' | 'hybrid'>('qr');
  const [currency, setCurrency] = useState('CRC');
  const [brandPrimary, setBrandPrimary] = useState('#B5691A');
  const [brandSecondary, setBrandSecondary] = useState('#187A5D');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('organizations').select('id, name, slug')
      .then(({ data }) => {
        if (data) {
          setOrgs(data);
          if (data.length === 1) setOrgId(data[0].id);
        }
      });
  }, []);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]); // LINT NOTE: eslint react-hooks/set-state-in-effect flags this —
  // move slug auto-gen into the name input's onChange instead:
  //   onChange={(e) => { setName(v); if (!slugTouched) setSlug(slugify(v)); }}
  // The EditEventModal below doesn't use slugify so is lint-clean as-is.

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !name.trim() || !slug.trim()) {
      setError('Organización, nombre y slug son requeridos.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase.from('events').insert({
      org_id: orgId,
      name: name.trim(),
      slug: slug.trim(),
      status,
      device_type: deviceType,
      currency,
      brand_primary: brandPrimary,
      brand_secondary: brandSecondary,
    });
    setBusy(false);
    if (insertError) {
      if (insertError.code === '23505') {
        setError('Ya existe un evento con ese slug. Elige otro.');
      } else {
        setError(insertError.message);
      }
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <Modal title="Crear evento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Organización *</label>
          <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Seleccionar organización...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Nombre *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej: Feria del Sol" />
        </div>
        <div className="field">
          <label>Slug *</label>
          <input
            className="input font-mono"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            onBlur={() => setSlugTouched(true)}
            required
            placeholder="feria-del-sol"
          />
          <p className="mt-1 text-xs text-ink-faint">URL: /e/{slug || '...'}/admin</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Estado</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Dispositivo</label>
            <select className="input" value={deviceType} onChange={(e) => setDeviceType(e.target.value as any)}>
              {DEVICE_TYPES.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="field">
            <label>Moneda</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="CRC" />
          </div>
          <div className="field">
            <label>Color primario</label>
            <input type="color" className="input h-10 cursor-pointer" value={brandPrimary} onChange={(e) => setBrandPrimary(e.target.value)} />
          </div>
          <div className="field">
            <label>Color secundario</label>
            <input type="color" className="input h-10 cursor-pointer" value={brandSecondary} onChange={(e) => setBrandSecondary(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Creando…' : 'Crear evento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Add "Nuevo evento" button and modal state to `Events.tsx`**

Add to `Events.tsx` (import useState, CreateEventModal):

```tsx
// src/pages/admin/Events.tsx — add state and button
// Add useQueryClient import on line 2 (`import { useQuery, useQueryClient } from '@tanstack/react-query';`)
// and useState import. Continue inside the component:
const [showCreate, setShowCreate] = useState(false)
const queryClient = useQueryClient()

// In the header div (next to the "N eventos" counter), matching Branches.tsx:
<button className="cta-gold" onClick={() => setShowCreate(true)}>
  Nuevo evento
</button>

// At bottom of return, before closing div:
{showCreate && (
  <CreateEventModal
    onClose={() => setShowCreate(false)}
    onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin-all-events'] })}
  />
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/Events.tsx src/pages/admin/events/CreateEventModal.tsx
git commit -m "feat: add create-event modal with org selector (super_admin)"
```

---

## Task 3: EditEventModal + ConfirmDeleteEventDialog

**Files:**
- Create: `src/pages/admin/events/EditEventModal.tsx`
- Create: `src/pages/admin/events/ConfirmDeleteEventDialog.tsx`
- Modify: `src/pages/admin/Events.tsx` (add Edit/Delete actions, modals)

**Interfaces:**
- Consumes: `event` row from the Events table query (fields: id, name, slug, status, device_type, currency, brand_primary, brand_secondary, org_id).
- Produces: After update/delete, invalidates `admin-all-events` query.

- [ ] **Step 1: Create `src/pages/admin/events/EditEventModal.tsx`**

Same fields as CreateEventModal but pre-filled. Accepts `event` prop.

```tsx
// src/pages/admin/events/EditEventModal.tsx
// STYLING: follow branches/EditBranchModal.tsx exactly — use .field, .input,
// .btn, .cta-solid, .text-rust classes (NOT raw Tailwind utility classes).
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import Modal from '../staff/Modal';

interface Org { id: string; name: string; slug: string }

interface EventRow {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'closed';
  device_type: 'nfc' | 'qr' | 'hybrid';
  currency: string;
  brand_primary: string;
  brand_secondary: string;
}

interface Props {
  event: EventRow;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditEventModal({ event, onClose, onSaved }: Props) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState(event.org_id);
  const [name, setName] = useState(event.name);
  const [slug, setSlug] = useState(event.slug);
  const [status, setStatus] = useState(event.status);
  const [deviceType, setDeviceType] = useState(event.device_type);
  const [currency, setCurrency] = useState(event.currency);
  const [brandPrimary, setBrandPrimary] = useState(event.brand_primary);
  const [brandSecondary, setBrandSecondary] = useState(event.brand_secondary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('organizations').select('id, name, slug')
      .then(({ data }) => { if (data) setOrgs(data); });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !name.trim() || !slug.trim()) {
      setError('Organización, nombre y slug son requeridos.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('events')
      .update({
        org_id: orgId,
        name: name.trim(),
        slug: slug.trim(),
        status,
        device_type: deviceType,
        currency,
        brand_primary: brandPrimary,
        brand_secondary: brandSecondary,
      })
      .eq('id', event.id);
    setBusy(false);
    if (updateError) {
      if (updateError.code === '23505') {
        setError('Ya existe otro evento con ese slug. Elige otro.');
      } else {
        setError(updateError.message);
      }
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal title="Editar evento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Organización *</label>
          <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Seleccionar organización...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Nombre *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Slug *</label>
          <input className="input font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <p className="mt-1 text-xs text-ink-faint">URL: /e/{slug || '...'}/admin</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Estado</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="draft">Borrador</option>
              <option value="active">Activo</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>
          <div className="field">
            <label>Dispositivo</label>
            <select className="input" value={deviceType} onChange={(e) => setDeviceType(e.target.value as any)}>
              <option value="qr">QR</option>
              <option value="nfc">NFC</option>
              <option value="hybrid">Híbrido</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="field">
            <label>Moneda</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <div className="field">
            <label>Color primario</label>
            <input type="color" className="input h-10 cursor-pointer" value={brandPrimary} onChange={(e) => setBrandPrimary(e.target.value)} />
          </div>
          <div className="field">
            <label>Color secundario</label>
            <input type="color" className="input h-10 cursor-pointer" value={brandSecondary} onChange={(e) => setBrandSecondary(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Create `src/pages/admin/events/ConfirmDeleteEventDialog.tsx`**

```tsx
// src/pages/admin/events/ConfirmDeleteEventDialog.tsx
// Follow branches/ConfirmDeleteDialog.tsx exactly: ConfirmDialog takes
// title/message/items/confirmLabel/cancelLabel/danger/busy/error.
import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import ConfirmDialog from '../staff/ConfirmDialog';

interface Props {
  eventId: string;
  eventName: string;
  onClose: () => void;
  onDeleted: () => void;
}

export default function ConfirmDeleteEventDialog({ eventId, eventName, onClose, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = [
    'Se eliminarán también sucursales, dispositivos, billeteras y transacciones (cascada).',
    'Esta acción es irreversible.',
  ];

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const { error: deleteError } = await supabase.from('events').delete().eq('id', eventId);
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    onDeleted();
    onClose();
  }

  return (
    <ConfirmDialog
      title="Eliminar evento"
      message={`¿Eliminar "${eventName}"?`}
      items={items}
      confirmLabel={busy ? 'Eliminando…' : 'Eliminar evento'}
      cancelLabel="Cancelar"
      danger
      busy={busy}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
```

- [ ] **Step 3: Add Edit/Delete state and modals to `Events.tsx`**

Add imports and state in `Events.tsx` (useState is already imported from Task 2):

```tsx
import EditEventModal from './events/EditEventModal';
import ConfirmDeleteEventDialog from './events/ConfirmDeleteEventDialog';

// State inside component (already has showCreate/queryClient from Task 2):
const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);
const [deletingEvent, setDeletingEvent] = useState<{ id: string; name: string } | null>(null);
```

Wire the existing action buttons in the Task 1 skeleton row `<td>` (keep `className="btn mr-2"` exactly as-is, just add `onClick`):

```tsx
<Link className="btn mr-2" to={`/e/${ev.slug}/admin/dashboard`}>Abrir</Link>
<button className="btn mr-2" onClick={() => setEditingEvent(ev)}>Editar</button>
<button className="btn" onClick={() => setDeletingEvent({ id: ev.id, name: ev.name })}>Eliminar</button>
```

At bottom of return, add modals:

```tsx
{showCreate && (
  <CreateEventModal
    onClose={() => setShowCreate(false)}
    onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin-all-events'] })}
  />
)}
{editingEvent && (
  <EditEventModal
    event={editingEvent}
    onClose={() => setEditingEvent(null)}
    onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-all-events'] })}
  />
)}
{deletingEvent && (
  <ConfirmDeleteEventDialog
    eventId={deletingEvent.id}
    eventName={deletingEvent.name}
    onClose={() => setDeletingEvent(null)}
    onDeleted={() => queryClient.invalidateQueries({ queryKey: ['admin-all-events'] })}
  />
)}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/Events.tsx src/pages/admin/events/EditEventModal.tsx src/pages/admin/events/ConfirmDeleteEventDialog.tsx
git commit -m "feat: add edit/delete event modals with cascade warning (super_admin)"
```

---

## Task 4: Polish + Final Verification

**Files:**
- Modify: `src/pages/admin/Events.tsx` (minor polish)
- Modify: `src/pages/admin/AdminLayout.tsx` (if needed for nav spacing)

**Interfaces:** None new. This task is final review.

- [ ] **Step 1: Ensure "Eventos" nav item appears in the right place in AdminLayout**

Already done in Task 1 Step 2 (NAV now: dashboard 01 → events 02 → branches 03 → staff 04 → devices 05 → transactions 06 → refunds 07). Verify by reading AdminLayout.tsx and confirming the array is exactly as in Task 1. If a previous editing pass left it out of order, reorder so events sits between dashboard and branches.

- [ ] **Step 2: Verify role gating is working**

Manually test in dev:
- Login as `event_admin` → the "Eventos" nav item must NOT be visible. Navigating directly to `/e/demo/admin/events` will still render the page (the AdminLayout guard accepts `event_admin`), but RLS (`event_admin_*` policies on `events`) scopes the query to their own org — the table must NOT show other organizations' events. Nav gating is the primary control.
- Login as `super_admin` → nav shows "Eventos", the page lists ALL events (across orgs) via `super_admin_all_events`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no warnings or errors.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: polish events management UI for super_admin demo"
```

---

## Task 5: Update HANDOFF.md

**Files:**
- Modify: `HANDOFF.md` (add Sprint 4.10 documenting the new events feature)

**Interfaces:** None.

- [ ] **Step 1: Update HANDOFF.md**

Add after the Sprint 4.5 section (and before `---` / section 3):

```markdown
### Sprint 4.10 (2026-09-11) — Admin CRUD: eventos

- **Spec/Plan**: `docs/superpowers/specs/2026-09-11-events-management-design.md` y `docs/superpowers/plans/2026-09-11-events-management.md`.
- Super_admin ahora tiene CRUD completo de eventos desde `/e/:eventSlug/admin/events` (nav item visible solo para `super_admin`).
- Página global: lista todos los eventos con organización, estado, dispositivo, moneda y fechas.
- Modal de creación con selector de organización (requerido), nombre, slug auto-generado, estado, tipo dispositivo, moneda, colores de marca.
- Modal de edición (mismos campos pre-cargados). Manejo de error `23505` (slug duplicado).
- Diálogo de eliminación con advertencia de cascada (branches/devices/wallets/transactions se borran en cascada).
- Acción "Abrir" navega a `/e/{slug}/admin/dashboard` para entrar al admin de ese evento.
- Patrón: `supabase.from()` directo con RLS, sin Edge Functions nuevas.
```

Update section 3 pending items to remove any reference to missing events management.

- [ ] **Step 2: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: document events management feature in HANDOFF (Sprint 4.10)"
```

---

## Execution Handoff

Plan complete and saved to `.plan/events-management.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
