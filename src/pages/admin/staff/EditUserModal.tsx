import { useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { updateUser, type ManageRole, type StaffUserRow, type UserApiError } from './api'

export default function EditUserModal({
  user,
  eventId,
  branches,
  onClose,
  onSuccess,
}: {
  user: StaffUserRow
  eventId: string
  branches: { id: string; name: string; type: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [fullName, setFullName] = useState(user.full_name ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<ManageRole>(user.role === 'event_admin' ? 'event_admin' : 'operator')
  const [branchIds, setBranchIds] = useState<string[]>(
    user.assignments.map((a) => a.branch_id).filter((b): b is string => Boolean(b)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLoss, setConfirmLoss] = useState<{ items: string[] } | null>(null)

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  async function handleSubmit(withConfirm = false) {
    setBusy(true)
    setError(null)
    try {
      await updateUser({
        user_id: user.id,
        full_name: fullName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        password: password || undefined,
        role,
        event_id: eventId,
        branch_ids: role === 'operator' ? branchIds : undefined,
        confirm_loss: withConfirm,
      })
      onSuccess()
    } catch (e) {
      const err = e as UserApiError
      if (err.code === 'confirm_assignment_loss') {
        const payload = err.payload as { assignments?: string[] } | null
        setConfirmLoss({ items: payload?.assignments ?? [] })
        setError(null)
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (confirmLoss) {
    return (
      <ConfirmDialog
        title="Cambio de rol"
        message="Este usuario tiene asignaciones que se perderán al cambiar de rol:"
        items={confirmLoss.items}
        confirmLabel="Cambiar rol"
        busy={busy}
        onConfirm={() => void handleSubmit(true)}
        onCancel={() => setConfirmLoss(null)}
      />
    )
  }

  return (
    <Modal title="Editar usuario" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="field">
          <label>Teléfono</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Contraseña (dejar vacío = no cambia)</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Rol</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as ManageRole)}>
            <option value="operator">Operador</option>
            <option value="event_admin">Admin del evento</option>
          </select>
        </div>
        {role === 'operator' ? (
          <div className="field">
            <label>Sucursales</label>
            <div className="flex flex-col gap-2">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm font-bold text-ink-soft">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    className="h-4 w-4"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-soft">Se mantiene como administrador de este evento.</p>
        )}
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="cta-solid max-w-[180px] text-sm"
            disabled={busy}
            onClick={() => void handleSubmit(false)}
          >
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
