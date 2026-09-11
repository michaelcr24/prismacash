import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
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
    wallets?: { balance: number } | null
    attendees?: { full_name: string } | null
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
            <p className="font-semibold">{device.attendees?.full_name ?? '—'}</p>
          </div>
          <div>
            <p className="cap text-ink-faint">Saldo</p>
            <p className="font-semibold">{formatMoney(device.wallets?.balance ?? 0)}</p>
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