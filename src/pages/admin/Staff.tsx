import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { useSessionRole } from '../../hooks/useSessionRole'
import { supabase } from '../../lib/supabase'

interface EventAdminRow {
  id: string
  profile: { id: string; full_name: string | null; phone: string | null; role: string }
}

interface BranchMemberRow {
  id: string
  profile: { id: string; full_name: string | null; phone: string | null; role: string }
  branch: { id: string; name: string; type: string }
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  event_admin: 'Admin del evento',
  operator: 'Operador',
}

const BRANCH_TYPE_LABEL: Record<string, string> = {
  recharge_kiosk: 'Quiosco de recarga',
  sales_point: 'Punto de venta',
  both: 'Ambos',
}

interface BranchOption {
  id: string
  name: string
  type: string
}

interface OperatorRow {
  id: string
  full_name: string | null
  phone: string | null
}

/** Personal del evento (lectura). La gestión de roles/asignaciones queda
 *  para super_admin por ahora. */
export default function Staff() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id

  const role = useSessionRole()
  const queryClient = useQueryClient()
  const isSuperAdmin = role === 'super_admin'

  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [mutating, setMutating] = useState(false)
  const [mutError, setMutError] = useState<string | null>(null)

  const { data: admins, isPending: adminsPending } = useQuery({
    queryKey: ['admin-staff-admins', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_admins')
        .select('id, profile(id, full_name, phone, role)')
        .eq('event_id', eventId!)
      if (error) throw error
      return (data ?? []) as unknown as EventAdminRow[]
    },
  })

  const { data: members, isPending: membersPending } = useQuery({
    queryKey: ['admin-staff-members', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_members')
        .select('id, profile(id, full_name, phone, role), branch(id, name, type)')
        .in(
          'branch_id',
          (await supabase.from('branches').select('id').eq('event_id', eventId!)).data?.map((b) => b.id) ?? [],
        )
      if (error) throw error
      return (data ?? []) as unknown as BranchMemberRow[]
    },
  })

  const { data: branches } = useQuery({
    queryKey: ['admin-staff-branches', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, type')
        .eq('event_id', eventId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as BranchOption[]
    },
  })

  const { data: operators } = useQuery({
    queryKey: ['admin-staff-operators'],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('role', 'operator')
      if (error) throw error
      return (data ?? []) as OperatorRow[]
    },
  })

  const pending = adminsPending || membersPending

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId || !selectedBranchId || !selectedUserId) return
    setMutating(true)
    setMutError(null)
    const { error } = await supabase
      .from('branch_members')
      .insert({ user_id: selectedUserId, branch_id: selectedBranchId })
    setMutating(false)
    if (error) {
      setMutError('No se pudo asignar: es posible que la persona ya esté en esa sucursal.')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['admin-staff-members', eventId] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-operators'] })
    setSelectedUserId('')
  }

  async function handleRemove(memberId: string) {
    if (!eventId) return
    setMutating(true)
    setMutError(null)
    const { error } = await supabase.from('branch_members').delete().eq('id', memberId)
    setMutating(false)
    if (error) {
      setMutError('No se pudo quitar la asignación.')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['admin-staff-members', eventId] })
  }

  const assignedUserIdsInBranch = new Set(
    (members ?? [])
      .filter((m) => m.branch?.id === selectedBranchId)
      .map((m) => m.profile?.id),
  )
  const availableOperators = (operators ?? []).filter((o) => !assignedUserIdsInBranch.has(o.id))

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Personal</h1>
        <span className="font-mono text-xs text-ink-faint">
          {(admins?.length ?? 0) + (members?.length ?? 0)} personas
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {isSuperAdmin && (
          <form onSubmit={handleAssign} className="card flex flex-col gap-3 p-4">
            <p className="text-sm font-bold">Asociar persona a sucursal</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="field">
                <label>Sucursal</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(e.target.value)
                    setSelectedUserId('')
                  }}
                  className="input"
                  required
                >
                  <option value="">Selecciona…</option>
                  {branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {BRANCH_TYPE_LABEL[b.type] ?? b.type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Persona</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="input"
                  required
                >
                  <option value="">Selecciona…</option>
                  {availableOperators.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name ?? o.phone ?? 'Sin nombre'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {mutError && <p className="text-sm text-rust">{mutError}</p>}
            <button
              type="submit"
              disabled={!selectedBranchId || !selectedUserId || mutating}
              className="cta-solid disabled:opacity-50"
            >
              {mutating ? 'Asignando…' : 'Asignar'}
            </button>
          </form>
        )}

        {pending && <p className="text-sm text-ink-faint">Cargando…</p>}
        {!pending && admins?.length === 0 && members?.length === 0 && (
          <p className="text-sm text-ink-faint">Sin personal asignado a este evento.</p>
        )}

        {admins?.map((a) => (
          <PersonCard key={a.id} name={a.profile?.full_name ?? 'Sin nombre'} role={a.profile?.role ?? 'event_admin'} phone={a.profile?.phone} branch={null} />
        ))}

        {members?.map((m) => (
          <PersonCard
            key={m.id}
            name={m.profile?.full_name ?? 'Sin nombre'}
            role={m.profile?.role ?? 'operator'}
            phone={m.profile?.phone}
            branch={m.branch?.name ?? '—'}
            onRemove={isSuperAdmin ? () => handleRemove(m.id) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function PersonCard({
  name,
  role,
  phone,
  branch,
  onRemove,
}: {
  name: string
  role: string
  phone: string | null
  branch: string | null
  onRemove?: () => void
}) {
  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div>
        <p className="font-semibold">{name}</p>
        <p className="text-xs text-ink-soft">
          {phone ?? 'Sin teléfono'} {branch ? `· ${branch}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="pill pill-mute">{ROLE_LABEL[role] ?? role}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-ink-faint underline underline-offset-2 hover:text-rust"
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  )
}
