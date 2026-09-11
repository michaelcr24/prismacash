import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'

interface TxRow {
  id: string
  event_id: string
  branch_id: string | null
  device_id: string
  type: string
  amount: number
  balance_after: number
  created_at: string
  branches: { name: string } | null
}

const TX_PILL: Record<string, { label: string; cls: string }> = {
  payment: { label: 'pago', cls: 'pill-ok' },
  topup: { label: 'recarga', cls: 'pill-gold' },
  initial_load: { label: 'recarga inicial', cls: 'pill-gold' },
  refund: { label: 'reembolso', cls: 'pill-warn' },
  migration_out: { label: 'migración', cls: 'pill-mute' },
  migration_in: { label: 'migración', cls: 'pill-mute' },
  adjustment: { label: 'ajuste', cls: 'pill-mute' },
}

const IS_INFLOW: Record<string, boolean> = {
  topup: true,
  initial_load: true,
  migration_in: true,
}

function formatMoney(n: number, currency = 'CRC') {
  const code = { CRC: 'es-CR', USD: 'en-US', EUR: 'es-ES' }[currency] ?? 'es-CR'
  return new Intl.NumberFormat(code, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Dashboard en tiempo real (sección 8.4 del plan). Suscribe a supabase
 * Realtime sobre `transactions` (INSERT del evento) para ir sumando sin
 * recargar, y usa polling cada 30s como respaldo por si la publicación
 * Realtime no está habilitada en el proyecto. RLS ya limita los datos al
 * evento del usuario (event_admin/operator ven solo su evento; super_admin
 * ve todo, por eso se filtra además por event_id).
 */
export default function Dashboard() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const queryClient = useQueryClient()

  const eventId = event?.id
  const currency = event?.currency ?? 'CRC'

  const { data: txs } = useQuery({
    queryKey: ['admin-transactions', eventId],
    enabled: Boolean(eventId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, event_id, branch_id, device_id, type, amount, balance_after, created_at, branches(name)')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as unknown as TxRow[]
    },
  })

  const { data: totals } = useQuery({
    queryKey: ['admin-totals', eventId],
    enabled: Boolean(eventId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: eventDevices, error: devicesError } = await supabase
        .from('devices')
        .select('id')
        .eq('event_id', eventId!)
      if (devicesError) throw devicesError
      const deviceIds = (eventDevices ?? []).map((d) => d.id)

      let circulating = 0
      if (deviceIds.length > 0) {
        const { data: wallets, error: walletsError } = await supabase
          .from('wallets')
          .select('balance')
          .in('device_id', deviceIds)
        if (walletsError) throw walletsError
        for (const w of wallets ?? []) circulating += Number(w.balance) || 0
      }

      const { count: activeCount } = await supabase
        .from('devices')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId!)
        .eq('status', 'active')

      return { circulating, activeDevices: activeCount ?? 0 }
    },
  })

  useEffect(() => {
    if (!eventId) return
    // invalidar en los inserts para refrescar los agregados del evento.
    const channel = supabase
      .channel(`tx:${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions', filter: `event_id=eq.${eventId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['admin-transactions', eventId] })
          queryClient.invalidateQueries({ queryKey: ['admin-totals', eventId] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [eventId, queryClient])

  const byHour = useMemo(() => {
    if (!txs) return []
    const today = startOfToday()
    const map = new Map<number, number>()
    for (const t of txs) {
      const d = new Date(t.created_at)
      if (d.getTime() < today) continue
      const isMoney = t.type === 'payment' || t.type === 'topup' || t.type === 'initial_load'
      if (!isMoney) continue
      map.set(d.getHours(), (map.get(d.getHours()) ?? 0) + Number(t.amount))
    }
    return Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, total: map.get(h) ?? 0 }))
  }, [txs])

  const todayTxs = useMemo(
    () => (txs ?? []).filter((t) => new Date(t.created_at).getTime() >= startOfToday()),
    [txs],
  )

  const kpis = useMemo(() => {
    const salesToday = todayTxs
      .filter((t) => t.type === 'payment')
      .reduce((s, t) => s + Number(t.amount), 0)
    const txToday = todayTxs.length
    const now = new Date()
    const minutes = Math.max(1, (now.getHours() * 60 + now.getMinutes()) || 1)
    return {
      salesToday,
      txPerMin: txToday / minutes,
      txToday,
    }
  }, [todayTxs])

  const feed = txs?.slice(0, 15) ?? []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-wide">Dashboard</h1>
        <span className="pill pill-ok">
          <span className="dot" />
          en vivo
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ventas de hoy" value={formatMoney(kpis.salesToday, currency)} />
        <Kpi label="Transacciones hoy" value={String(kpis.txToday)} />
        <Kpi label="TX / minuto" value={kpis.txPerMin.toFixed(1)} />
        <Kpi label="Dispositivos activos" value={String(totals?.activeDevices ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <p className="mb-3 font-mono text-[0.72rem] uppercase tracking-wider text-ink-faint">
            Ingresos por hora (hoy)
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={byHour} margin={{ left: -14, right: 8, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="fillSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-violet)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--color-violet)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }}
                interval={3}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--color-ink-faint)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip formatter={(v) => [formatMoney(Number(v), currency), 'Total']} />
              <Area
                type="monotone"
                dataKey="total"
                stroke="var(--color-violet)"
                strokeWidth={2}
                fill="url(#fillSales)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card flex flex-col p-4">
          <p className="mb-3 font-mono text-[0.72rem] uppercase tracking-wider text-ink-faint">Actividad reciente</p>
          <div className="feed">
            {feed.length === 0 && <p className="py-6 text-sm text-ink-faint">Sin transacciones todavía.</p>}
            {feed.map((t) => {
              const meta = TX_PILL[t.type] ?? { label: t.type, cls: 'pill-mute' }
              const inflow = IS_INFLOW[t.type] ?? false
              return (
                <div key={t.id} className="feed-row">
                  <span className={meta.cls}>{meta.label}</span>
                  <span className="truncate text-ink-soft">{t.branches?.name ?? '—'}</span>
                  <span className={`amt ${inflow ? 'pos' : 'neg'}`}>
                    {inflow ? '+' : '-'}
                    {formatMoney(Math.abs(t.amount), currency)}
                  </span>
                  <span className="time">
                    {new Date(t.created_at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="cap">{label}</span>
      <span className="val">{value}</span>
    </div>
  )
}
