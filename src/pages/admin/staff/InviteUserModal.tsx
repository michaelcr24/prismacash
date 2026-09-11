import { useState } from 'react'
import Modal from './Modal'
import { inviteUser, type ManageRole, type UserApiError } from './api'

export default function InviteUserModal({
  eventId,
  branches,
  onClose,
  onSuccess,
}: {
  eventId: string
  branches: { id: string; name: string; type: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<ManageRole>('operator')
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      await inviteUser({
        email,
        full_name: fullName || undefined,
        role,
        event_id: eventId,
        branch_ids: role === 'operator' ? branchIds : undefined,
      })
      setDone(true)
    } catch (e) {
      setError((e as UserApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title="Invitación enviada" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          Se envió una invitación a {email}. Al aceptarla, el usuario ya tendrá su rol y asignaciones listos.
        </p>
        <div className="mt-5 flex justify-end">
          <button type="button" className="cta-solid max-w-[180px] text-sm" onClick={onSuccess}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={step === 1 ? 'Invitar por email' : 'Asignar sucursales'} onClose={onClose}>
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as ManageRole)}>
              <option value="operator">Operador</option>
              <option value="event_admin">Admin del evento</option>
            </select>
          </div>
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={!email}
              onClick={() => setStep(2)}
            >
              Continuar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {role === 'operator' ? (
            <>
              <p className="text-sm text-ink-soft">Elige las sucursales para este operador.</p>
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
                {branches.length === 0 && <p className="text-sm text-ink-faint">Este evento no tiene sucursales.</p>}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Se asignará como administrador de este evento.</p>
          )}
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy}>
              Volver
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              {busy ? 'Enviando…' : 'Enviar invitación'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
