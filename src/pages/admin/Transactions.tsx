import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'

interface TxRow {
  id: string
  type: string
  amount: number
  balance_after: number
  created_at: string
  branches: { name: string } | null
  devices: { uid: string } | null
}

const TX_LABEL: Record<string, string> = {
  initial_load: 'Recarga inicial',
  topup: 'Recarga',
  payment: 'Pago',
  refund: 'Reembolso',
  migration_out: 'Migración salida',
  migration_in: 'Migración entrada',
  adjustment: 'Ajuste',
}

const TYPE_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'payment', label: 'Pagos' },
  { value: 'initial_load', label: 'Recargas iniciales' },
  { value: 'topup', label: 'Recargas' },
  { value: 'refund', label: 'Reembolsos' },
]

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n)
}

/** Historial de transacciones con filtros por tipo y exportación a CSV. */
export default function Transactions() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const [typeFilter, setTypeFilter] = useState('all')
  const [limit, setLimit] = useState(200)

  const { data: txs, isPending } = useQuery({
    queryKey: ['admin-transactions-list', eventId, limit],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, type, amount, balance_after, created_at, branches(name), devices(uid)')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as unknown as TxRow[]
    },
  })

  const filtered = useMemo(
    () => (txs ?? []).filter((t) => typeFilter === 'all' || t.type === typeFilter),
    [txs, typeFilter],
  )

  function exportCsv() {
    const rows = filtered.map((t) => [
      t.created_at,
      TX_LABEL[t.type] ?? t.type,
      t.amount,
      t.balance_after,
      t.branches?.name ?? '',
      t.devices?.uid ?? '',
    ])
    const header = ['Fecha', 'Tipo', 'Monto', 'Saldo posterior', 'Sucursal', 'Dispositivo']
    const csv = [header.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transacciones-${eventSlug}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Transacciones</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input w-auto"
          >
            {TYPE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="input w-auto">
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="btn font-semibold disabled:opacity-50"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="table-card mt-5">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Sucursal</th>
              <th>Dispositivo</th>
              <th className="text-right">Monto</th>
              <th className="text-right">Saldo posterior</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={6} className="text-ink-faint">
                  Cargando…
                </td>
              </tr>
            )}
            {!isPending && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-ink-faint">
                  Sin transacciones.{typeFilter !== 'all' ? ' Cambia el filtro.' : ''}
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap text-xs">
                  {new Date(t.created_at).toLocaleString('es-CR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </td>
                <td>{TX_LABEL[t.type] ?? t.type}</td>
                <td>{t.branches?.name ?? '—'}</td>
                <td className="font-mono text-xs">{t.devices?.uid ?? '—'}</td>
                <td className="text-right font-mono text-xs">{formatMoney(t.amount)}</td>
                <td className="text-right font-mono text-xs">{formatMoney(t.balance_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
