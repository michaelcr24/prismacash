import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { supabase } from '../../lib/supabase'
import CreateBranchModal from './branches/CreateBranchModal'
import EditBranchModal from './branches/EditBranchModal'
import ConfirmDeleteDialog from './branches/ConfirmDeleteDialog'

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

export default function Branches() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const queryClient = useQueryClient()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BranchRow | null>(null)
  const [deleting, setDeleting] = useState<BranchRow | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

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

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-branches', eventId] })
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Sucursales</h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-ink-faint">{branches?.length ?? 0} sucursales</span>
          <button className="cta-gold" onClick={() => setCreating(true)}>
            Nueva sucursal
          </button>
        </div>
      </div>

      <div className="table-card mt-5">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Terminales</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={5} className="text-ink-faint">Cargando…</td>
              </tr>
            )}
            {!isPending && branches?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-ink-faint">
                  Sin sucursales en este evento. Crea la primera.
                </td>
              </tr>
            )}
            {branches?.map((b) => (
              <>
                <tr key={b.id} onClick={() => setExpanded(expanded === b.id ? null : b.id)} className="cursor-pointer">
                  <td className="font-semibold">{b.name}</td>
                  <td>{TYPE_LABEL[b.type] ?? b.type}</td>
                  <td>
                    <span className={branchPill(b.is_active)}>{b.is_active ? 'Activa' : 'Inactiva'}</span>
                  </td>
                  <td className="font-mono text-xs">{b.terminals.length}</td>
                  <td className="text-right">
                    <button
                      className="btn mr-2"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(b)
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(b)
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
                {expanded === b.id && (
                  <tr key={`${b.id}-terminals`}>
                    <td colSpan={5}>
                      <div className="px-3 py-2">
                        {b.terminals.length === 0 && (
                          <p className="text-sm text-ink-faint">Sin terminales vinculadas.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {b.terminals.map((t) => (
                            <span key={t.id} className={`chip ${t.is_active ? '' : 'opacity-50'}`}>
                              {t.device_label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {creating && eventId && (
        <CreateBranchModal eventId={eventId} onCreated={refresh} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <EditBranchModal branch={editing} onUpdated={refresh} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          branch={deleting}
          terminalCount={deleting.terminals.length}
          onDeleted={refresh}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}