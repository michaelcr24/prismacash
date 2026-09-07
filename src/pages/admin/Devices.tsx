import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'

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

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n)
}

/** Inventario de dispositivos del evento (lectura). El alta/bloqueo corre
 *  por el quiosco/POS o por super_admin. */
export default function Devices() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id

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

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Dispositivos</h1>
        <span className="font-mono text-xs text-ink-faint">{devices?.length ?? 0} registrados</span>
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
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={5} className="text-ink-faint">
                  Cargando…
                </td>
              </tr>
            )}
            {!isPending && devices?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-ink-faint">
                  Sin dispositivos en este evento.
                </td>
              </tr>
            )}
            {devices?.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-xs">{d.uid}</td>
                <td>{d.attendee?.full_name ?? '—'}</td>
                <td className="text-xs uppercase">{d.type}</td>
                <td>
                  <span className={STATUS_PILL[d.status] ?? 'pill-mute'}>{STATUS_LABEL[d.status] ?? d.status}</span>
                </td>
                <td className="text-right font-mono text-xs">{formatMoney(d.wallet?.balance ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
