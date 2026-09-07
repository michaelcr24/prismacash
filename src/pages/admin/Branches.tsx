import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'

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

/** Lista de sucursales y sus terminales (lectura). La edición es de
 *  super_admin por ahora. */
export default function Branches() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id

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

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Sucursales y terminales</h1>
        <span className="font-mono text-xs text-ink-faint">{branches?.length ?? 0} sucursales</span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {isPending && <p className="text-sm text-ink-faint">Cargando…</p>}
        {!isPending && branches?.length === 0 && <p className="text-sm text-ink-faint">Sin sucursales en este evento.</p>}
        {branches?.map((b) => (
          <div key={b.id} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{b.name}</p>
                <p className="text-xs text-ink-soft">{TYPE_LABEL[b.type] ?? b.type}</p>
              </div>
              <span className={branchPill(b.is_active)}>{b.is_active ? 'Activa' : 'Inactiva'}</span>
            </div>
            {b.terminals.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {b.terminals.map((t) => (
                  <span
                    key={t.id}
                    className={`chip ${t.is_active ? '' : 'opacity-50'}`}
                  >
                    {t.device_label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
