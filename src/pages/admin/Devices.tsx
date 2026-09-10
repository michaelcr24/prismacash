import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'
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