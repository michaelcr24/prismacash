import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
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

/** Personal del evento (lectura). La gestión de roles/asignaciones queda
 *  para super_admin por ahora. */
export default function Staff() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id

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

  const pending = adminsPending || membersPending

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Personal</h1>
        <span className="font-mono text-xs text-ink-faint">
          {(admins?.length ?? 0) + (members?.length ?? 0)} personas
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
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
}: {
  name: string
  role: string
  phone: string | null
  branch: string | null
}) {
  return (
    <div className="card flex items-center justify-between gap-3 p-4">
      <div>
        <p className="font-semibold">{name}</p>
        <p className="text-xs text-ink-soft">
          {phone ?? 'Sin teléfono'} {branch ? `· ${branch}` : ''}
        </p>
      </div>
      <span className="pill pill-mute">{ROLE_LABEL[role] ?? role}</span>
    </div>
  )
}