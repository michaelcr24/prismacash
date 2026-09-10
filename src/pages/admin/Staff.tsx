import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEvent } from '../../hooks/useEvent'
import { useSessionRole } from '../../hooks/useSessionRole'
import { supabase } from '../../lib/supabase'
import UserTable from './staff/UserTable'
import CreateUserModal from './staff/CreateUserModal'
import InviteUserModal from './staff/InviteUserModal'
import EditUserModal from './staff/EditUserModal'
import ConfirmDialog from './staff/ConfirmDialog'
import { deleteUser, type UserApiError } from './staff/api'
import type { StaffUserRow } from './staff/api'

type Tab = 'all' | 'admins' | 'operators'

interface AdminBridge {
  user_id: string
}
interface MemberBridge {
  profiles: { id: string }
  branches: { id: string; name: string } | null
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'admins', label: 'Admins' },
  { value: 'operators', label: 'Operadores' },
]

export default function Staff() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const eventId = event?.id
  const role = useSessionRole()
  const isSuperAdmin = role === 'super_admin'
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState<'none' | 'manual' | 'invite'>('none')
  const [editing, setEditing] = useState<StaffUserRow | null>(null)
  const [deleting, setDeleting] = useState<StaffUserRow | null>(null)
  const [mutError, setMutError] = useState<string | null>(null)
  const [mutBusy, setMutBusy] = useState(false)

  const { data: users, isPending } = useQuery({
    queryKey: ['admin-staff-users', eventId, isSuperAdmin],
    enabled: Boolean(eventId),
    queryFn: async () => {
      let q = supabase.from('staff_users').select('id, org_id, email, full_name, phone, role')
      if (isSuperAdmin && event?.org_id) q = q.eq('org_id', event.org_id)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Pick<StaffUserRow, 'id' | 'email' | 'full_name' | 'phone' | 'role'>[]
    },
  })

  const { data: admins } = useQuery({
    queryKey: ['admin-staff-admins', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_admins')
        .select('user_id')
        .eq('event_id', eventId!)
      if (error) throw error
      return (data ?? []) as unknown as AdminBridge[]
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
      return (data ?? []) as { id: string; name: string; type: string }[]
    },
  })

  const { data: members } = useQuery({
    queryKey: ['admin-staff-members', eventId],
    enabled: Boolean(eventId) && Boolean(branches?.length),
    queryFn: async () => {
      const branchIds = (branches ?? []).map((b) => b.id)
      const { data, error } = await supabase
        .from('branch_members')
        .select('profiles(id), branches(id, name)')
        .in('branch_id', branchIds)
      if (error) throw error
      return (data ?? []) as unknown as MemberBridge[]
    },
  })

  const adminIds = useMemo(() => new Set((admins ?? []).map((a) => a.user_id as string)), [admins])
  const branchByUser = useMemo(() => {
    const map = new Map<string, { branch_id: string; branch_name: string }[]>()
    for (const m of members ?? []) {
      const userId = m.profiles?.id
      if (!userId || !m.branches) continue
      const list = map.get(userId) ?? []
      list.push({ branch_id: m.branches.id, branch_name: m.branches.name })
      map.set(userId, list)
    }
    return map
  }, [members])

  const rows = useMemo<StaffUserRow[]>(() => {
    const all = (users ?? []).map((u) => {
      const assignments =
        u.role === 'operator' ? (branchByUser.get(u.id) ?? []) : adminIds.has(u.id) ? [{ branch_id: null, branch_name: null }] : []
      return { ...u, assignments }
    })
    const filtered = tab === 'all' ? all : all.filter((u) => (tab === 'admins' ? u.role === 'event_admin' : u.role === 'operator'))
    const q = search.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter((u) => (u.full_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, adminIds, branchByUser, tab, search])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-staff-users', eventId, isSuperAdmin] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-admins', eventId] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-members', eventId] })
    queryClient.invalidateQueries({ queryKey: ['admin-staff-branches', eventId] })
  }

  function closeModals() {
    setCreating('none')
    setEditing(null)
    setMutError(null)
  }

  async function handleDelete() {
    if (!deleting) return
    setMutBusy(true)
    setMutError(null)
    try {
      await deleteUser(deleting.id)
      setDeleting(null)
      refresh()
    } catch (e) {
      setMutError((e as UserApiError).message)
    } finally {
      setMutBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-wide">Personal</h1>
        <span className="font-mono text-xs text-ink-faint">{rows.length} personas</span>
      </div>

      {isSuperAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="cta-solid max-w-[200px] text-sm" onClick={() => setCreating('manual')}>
            Crear usuario
          </button>
          <button type="button" className="btn" onClick={() => setCreating('invite')}>
            Invitar por email
          </button>
          <input
            className="input max-w-[280px]"
            placeholder="Buscar por nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {!isSuperAdmin && (
        <input
          className="input mt-4 max-w-[280px]"
          placeholder="Buscar por nombre o email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="mt-5 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={tab === t.value ? 'pill pill-gold' : 'pill pill-mute'}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mutError && <p className="mt-3 text-sm text-rust">{mutError}</p>}
      {isPending && <p className="mt-4 text-sm text-ink-faint">Cargando…</p>}
      {!isPending && (
        <UserTable
          rows={rows}
          canManage={isSuperAdmin}
          onEdit={(u) => setEditing(u as StaffUserRow)}
          onDelete={(u) => setDeleting(u as StaffUserRow)}
        />
      )}

      {creating === 'manual' && eventId && branches && (
        <CreateUserModal
          eventId={eventId}
          branches={branches}
          onClose={closeModals}
          onSuccess={() => {
            closeModals()
            refresh()
          }}
        />
      )}
      {creating === 'invite' && eventId && branches && (
        <InviteUserModal
          eventId={eventId}
          branches={branches}
          onClose={closeModals}
          onSuccess={() => {
            closeModals()
            refresh()
          }}
        />
      )}
      {editing && eventId && branches && (
        <EditUserModal
          user={editing}
          eventId={eventId}
          branches={branches}
          onClose={closeModals}
          onSuccess={() => {
            closeModals()
            refresh()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Eliminar usuario"
          message={`¿Eliminar a ${deleting.full_name ?? deleting.email}? Esta acción es permanente.`}
          confirmLabel="Eliminar"
          danger
          busy={mutBusy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}