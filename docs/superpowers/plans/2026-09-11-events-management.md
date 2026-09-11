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
- Style: Tailwind 4 utility classes; follow existing modal patterns (see `src/pages/admin/staff/Modal.tsx`, `branches/CreateBranchModal.tsx`).
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

In `src/pages/admin/AdminLayout.tsx`, add a new entry to the NAV array *and* gate it:

```tsx
// src/pages/admin/AdminLayout.tsx — add to NAV array
{ path: 'events', label: 'Eventos' },
```

Then, in the sidebar rendering, filter NAV items: only show "Eventos" if `role === 'super_admin'`:

```tsx
// AdminLayout.tsx — NAV item rendering: add a guard
{(item.path === 'events' ? role === 'super_admin' : true) && (
  <NavLink ...>...</NavLink>
)}
```

Alternatively, restructure NAV to include an optional `superAdminOnly?: boolean` field and filter in the render loop. Whichever is cleaner with the existing pattern.

- [ ] **Step 3: Create skeleton `src/pages/admin/Events.tsx`**

Create the file with a minimal skeleton that loads events and renders a table:

```tsx
// src/pages/admin/Events.tsx
import { useQuery } from '@tanstack/query-core';
import { useEvent } from '../../hooks/useEvent';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';

export default function Events() {
  const { data: events, isLoading, error } = useQuery({
    queryKey: ['admin-all-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, name, slug, status, device_type, currency, brand_primary, brand_secondary, starts_at, ends_at, org_id, organizations!inner(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="p-8 text-center text-gray-500">Cargando eventos...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error al cargar eventos.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Eventos</h1>
        {/* Button added in Task 2 */}
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Nombre</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tipo dispositivo</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Moneda</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Organización</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Inicio</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Cierre</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events?.map((ev) => (
              <tr key={ev.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{ev.name}</td>
                <td className="px-4 py-3 text-gray-600">{ev.slug}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    ev.status === 'active' ? 'bg-green-100 text-green-800' :
                    ev.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {ev.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{ev.device_type}</td>
                <td className="px-4 py-3 text-gray-600">{ev.currency}</td>
                <td className="px-4 py-3 text-gray-600">{(ev.organizations as any)?.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{ev.starts_at ? new Date(ev.starts_at).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 text-gray-600">{ev.ends_at ? new Date(ev.ends_at).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <Link
                    to={`/e/${ev.slug}/admin/dashboard`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
            {events?.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No hay eventos.</td></tr>
            )}
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
  }, [name, slugTouched]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !name.trim() || !slug.trim()) {
      setError('Organización, nombre y slug son requeridos.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: insertErr } = await supabase.from('events').insert({
      org_id: orgId,
      name: name.trim(),
      slug: slug.trim(),
      status,
      device_type: deviceType,
      currency,
      brand_primary: brandPrimary,
      brand_secondary: brandSecondary,
    });
    setSaving(false);
    if (insertErr) {
      if (insertErr.code === '23505') {
        setError('Ya existe un evento con ese slug. Elige otro.');
      } else {
        setError(insertErr.message);
      }
      return;
    }
    onCreated();
    onClose();
  };

  return (
    <Modal title="Crear evento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organización *</label>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Seleccionar organización...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Ej: Feria del Sol"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slug *</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            onBlur={() => setSlugTouched(true)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            placeholder="feria-del-sol"
          />
          <p className="text-xs text-gray-500 mt-1">Se usa en la URL: /e/{slug || '...'}/admin</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="draft">Borrador</option>
              <option value="active">Activo</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de dispositivo</label>
            <select
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value as any)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="qr">QR</option>
              <option value="nfc">NFC</option>
              <option value="hybrid">Híbrido</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="CRC"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color primario</label>
            <input
              type="color"
              value={brandPrimary}
              onChange={(e) => setBrandPrimary(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color secundario</label>
            <input
              type="color"
              value={brandSecondary}
              onChange={(e) => setBrandSecondary(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg cursor-pointer"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear evento'}
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
import { useState } from 'react';
import { useQueryClient } from '@tanstack/query-core';
import CreateEventModal from './events/CreateEventModal';

// Inside the component:
const [showCreate, setShowCreate] = useState(false);
const queryClient = useQueryClient();

// In the header div, add button:
<button
  onClick={() => setShowCreate(true)}
  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
>
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('organizations').select('id, name, slug')
      .then(({ data }) => { if (data) setOrgs(data); });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !name.trim() || !slug.trim()) {
      setError('Organización, nombre y slug son requeridos.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: updateErr } = await supabase
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
    setSaving(false);
    if (updateErr) {
      if (updateErr.code === '23505') {
        setError('Ya existe otro evento con ese slug. Elige otro.');
      } else {
        setError(updateErr.message);
      }
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal title="Editar evento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organización *</label>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Seleccionar organización...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slug *</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">URL: /e/{slug}/admin</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="draft">Borrador</option>
              <option value="active">Activo</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de dispositivo</label>
            <select value={deviceType} onChange={(e) => setDeviceType(e.target.value as any)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="qr">QR</option>
              <option value="nfc">NFC</option>
              <option value="hybrid">Híbrido</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
            <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color primario</label>
            <input type="color" value={brandPrimary} onChange={(e) => setBrandPrimary(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg cursor-pointer" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color secundario</label>
            <input type="color" value={brandSecondary} onChange={(e) => setBrandSecondary(e.target.value)}
              className="w-full h-10 border border-gray-300 rounded-lg cursor-pointer" />
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar cambios'}
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
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    const { error: delErr } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);
    setDeleting(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    onDeleted();
    onClose();
  };

  return (
    <ConfirmDialog
      title={`Eliminar evento "${eventName}"`}
      description="Esta acción eliminará el evento y todos sus datos asociados (sucursales, dispositivos, billeteras, transacciones). Esta acción es irreversible."
      confirmLabel={deleting ? 'Eliminando...' : 'Eliminar evento'}
      onConfirm={handleDelete}
      onCancel={onClose}
      error={error}
    />
  );
}
```

- [ ] **Step 3: Add Edit/Delete state and modals to `Events.tsx`**

Add imports and state in `Events.tsx`:

```tsx
import EditEventModal from './events/EditEventModal';
import ConfirmDeleteEventDialog from './events/ConfirmDeleteEventDialog';

// State inside component:
const [editingEvent, setEditingEvent] = useState<any>(null);
const [deletingEvent, setDeletingEvent] = useState<{ id: string; name: string } | null>(null);
```

In the table row actions `<td>`, add Edit and Delete links:

```tsx
<td className="px-4 py-3 text-right space-x-2">
  <Link to={`/e/${ev.slug}/admin/dashboard`}
    className="text-blue-600 hover:underline text-xs">Abrir</Link>
  <button onClick={() => setEditingEvent(ev)}
    className="text-yellow-600 hover:underline text-xs">Editar</button>
  <button onClick={() => setDeletingEvent({ id: ev.id, name: ev.name })}
    className="text-red-600 hover:underline text-xs">Eliminar</button>
</td>
```

At bottom of return, add modals:

```tsx
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

If the NAV array ordering matters, place "Eventos" after "Dashboard" and before "Sucursales" to reflect logical hierarchy (events → branches → devices → staff → ...). Adjust the NAV array accordingly.

- [ ] **Step 2: Verify role gating is working**

Manually test in dev: login as `event_admin`, navigate to `/e/demo/admin/events` → should redirect to `/login` (or show access denied). Login as `super_admin` → nav shows "Eventos", page loads.

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
