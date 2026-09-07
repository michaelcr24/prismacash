import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'

interface RefundRow {
  id: string
  amount: number
  status: string
  created_at: string
  device: { uid: string; attendee: { full_name: string } | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  paid: 'Pagado',
}

const STATUS_PILL: Record<string, string> = {
  pending: 'pill-gold',
  approved: 'pill-mute',
  rejected: 'pill-warn',
  paid: 'pill-ok',
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n)
}

/** Cola de solicitudes de reembolso (sección 5.4 del plan). Solo lectura
 *  por ahora: la decisión arbitraria queda para super_admin. */
export default function Refunds() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id

  const { data: refunds, isPending } = useQuery({
    queryKey: ['admin-refunds', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refund_requests')
        .select('id, amount, status, created_at, device(uid, attendee(full_name))')
        .in(
          'device_id',
          (await supabase.from('devices').select('id').eq('event_id', eventId!)).data?.map((d) => d.id) ?? [],
        )
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as RefundRow[]
    },
  })

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Reembolsos</h1>
        <span className="font-mono text-xs text-ink-faint">{refunds?.length ?? 0} solicitudes</span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {isPending && <p className="text-sm text-ink-faint">Cargando…</p>}
        {!isPending && refunds?.length === 0 && <p className="text-sm text-ink-faint">Sin solicitudes de reembolso.</p>}
        {refunds?.map((r) => (
          <div key={r.id} className="card flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-mono text-sm font-semibold">{formatMoney(r.amount)}</p>
              <p className="text-xs text-ink-soft">
                {r.device?.attendee?.full_name ?? 'Asistente desconocido'} ·{' '}
                <span className="font-mono">{r.device?.uid ?? '—'}</span>
              </p>
              <p className="text-xs text-ink-faint">
                {new Date(r.created_at).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            <span className={STATUS_PILL[r.status] ?? 'pill-mute'}>{STATUS_LABEL[r.status] ?? r.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}