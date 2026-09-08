import { useState } from 'react'
import Modal from './Modal'
import { createUser, type ManageRole, type UserApiError } from './api'

export default function CreateUserModal({
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
  const [password, setPassword] = useState('')
  const [autoPassword, setAutoPassword] = useState(true)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<ManageRole>('operator')
  const [branchIds, setBranchIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const res = await createUser({
        email,
        password: autoPassword ? undefined : password,
        full_name: fullName,
        phone: phone || undefined,
        role,
        event_id: eventId,
        branch_ids: role === 'operator' ? branchIds : undefined,
      })
      if (res.generated_password) setCreatedPassword(res.generated_password)
      setDone(true)
    } catch (e) {
      setError((e as UserApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title="Usuario creado" onClose={onClose}>
        <p className="text-sm text-ink-soft">
          {email} ya puede iniciar sesiÃ³n{createdPassword && ' con la contraseÃ±a temporal indicada abajo.'}
        </p>
        {createdPassword && (
          <div className="mt-4 rounded-2xl border-[1.5px] border-line bg-lilac p-4">
            <p className="text-xs font-bold text-ink-soft">ContraseÃ±a temporal (no se vuelve a mostrar)</p>
            <p className="font-mono text-lg font-bold text-violet">{createdPassword}</p>
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <button type="button" className="cta-solid max-w-[180px] text-sm" onClick={onSuccess}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={step === 1 ? 'Crear usuario' : 'Asignar sucursales'} onClose={onClose}>
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
            <label>TelÃ©fono (opcional)</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as ManageRole)}>
              <option value="operator">Operador</option>
              <option value="event_admin">Admin del evento</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
            <input
              type="checkbox"
              checked={autoPassword}
              onChange={(e) => setAutoPassword(e.target.checked)}
              className="h-4 w-4"
            />
            Generar contraseÃ±a automÃ¡ticamente
          </label>
          {!autoPassword && (
            <div className="field">
              <label>ContraseÃ±a</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-sm text-rust">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="cta-solid max-w-[180px] text-sm"
              disabled={busy || !email || (!autoPassword && password.length < 8)}
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
            <p className="text-sm text-ink-soft">Se asignarÃ¡ como administrador de este evento.</p>
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
              {busy ? 'Creandoâ€¦' : 'Crear usuario'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
