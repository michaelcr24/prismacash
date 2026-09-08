import type { StaffUserRow } from './api'

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  event_admin: 'Admin del evento',
  operator: 'Operador',
}

export default function UserTable({
  rows,
  canManage,
  onEdit,
  onDelete,
}: {
  rows: StaffUserRow[]
  canManage: boolean
  onEdit: (user: StaffUserRow) => void
  onDelete: (user: StaffUserRow) => void
}) {
  return (
    <div className="table-card mt-5">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Asignaciones</th>
            {canManage && <th className="text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={canManage ? 5 : 4} className="text-ink-faint">
                Sin usuarios para esta vista.
              </td>
            </tr>
          )}
          {rows.map((u) => (
            <tr key={u.id}>
              <td>
                <div className="flex items-center gap-2">
                  <span className="avatar">{u.full_name?.trim().charAt(0).toUpperCase() ?? '?'}</span>
                  <span className="font-semibold">{u.full_name ?? 'Sin nombre'}</span>
                </div>
              </td>
              <td className="text-xs">{u.email || '—'}</td>
              <td>
                <span className="pill pill-mute">{ROLE_LABEL[u.role] ?? u.role}</span>
              </td>
              <td className="text-xs text-ink-soft">
                {u.role === 'operator'
                  ? u.assignments.length > 0
                    ? u.assignments.map((a) => a.branch_name).filter(Boolean).join(', ')
                    : 'Sin asignar'
                  : 'Este evento'}
              </td>
              {canManage && (
                <td className="text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      className="text-xs font-bold text-violet underline underline-offset-2 hover:text-violet-deep"
                      onClick={() => onEdit(u)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-xs font-bold text-rust underline underline-offset-2 hover:text-rust-fill"
                      onClick={() => onDelete(u)}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
