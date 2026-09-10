import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal from '../staff/Modal'

const TYPES = [
  { value: 'recharge_kiosk', label: 'Quiosco de recarga' },
  { value: 'sales_point', label: 'Punto de venta' },
  { value: 'both', label: 'Ambos' },
]

export default function EditBranchModal({
  branch,
  onUpdated,
  onClose,
}: {
  branch: { id: string; name: string; type: string; is_active: boolean }
  onUpdated: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(branch.name)
  const [type, setType] = useState(branch.type)
  const [isActive, setIsActive] = useState(branch.is_active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('branches')
      .update({ name: name.trim(), type, is_active: isActive })
      .eq('id', branch.id)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onUpdated()
    onClose()
  }

  return (
    <Modal title="Editar sucursal" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activa
        </label>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}