import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import CreateEventModal from './events/CreateEventModal'
import EditEventModal from './events/EditEventModal'
import ConfirmDeleteEventDialog from './events/ConfirmDeleteEventDialog'

interface EventRow {
  id: string
  org_id: string
  name: string
  slug: string
  status: string
  device_type: string
  currency: string
  brand_primary: string
  brand_secondary: string
  starts_at: string | null
  ends_at: string | null
  organizations: { name: string } | { name: string }[] | null
}

function orgName(orgs: EventRow['organizations']): string {
  if (!orgs) return '—'
  if (Array.isArray(orgs)) return orgs[0]?.name ?? '—'
  return orgs.name
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activo',
  closed: 'Cerrado',
}

function statusPill(status: string): string {
  if (status === 'active') return 'pill pill-ok'
  if (status === 'draft') return 'pill pill-warn'
  return 'pill pill-mute'
}

const DEVICE_LABEL: Record<string, string> = {
  nfc: 'NFC',
  qr: 'QR',
  hybrid: 'Híbrido',
}

export default function Events() {
  const [showCreate, setShowCreate] = useState(false)
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null)
  const [deletingEvent, setDeletingEvent] = useState<{ id: string; name: string } | null>(null)
  const queryClient = useQueryClient()
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
          <button className="cta-gold" onClick={() => setShowCreate(true)}>
            Nuevo evento
          </button>
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
                <td>{orgName(ev.organizations)}</td>
                <td className="text-xs">{ev.starts_at ? new Date(ev.starts_at).toLocaleDateString() : '—'}</td>
                <td className="text-xs">{ev.ends_at ? new Date(ev.ends_at).toLocaleDateString() : '—'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link className="btn mr-2" to={`/e/${ev.slug}/admin/dashboard`}>
                    Abrir
                  </Link>
                  <button className="btn mr-2" onClick={() => setEditingEvent(ev)}>Editar</button>
                  <button className="btn" onClick={() => setDeletingEvent({ id: ev.id, name: ev.name })}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  )
}