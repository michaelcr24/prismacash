import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal from '../staff/Modal'

const TYPES = [
  { value: 'recharge_kiosk', label: 'Quiosco de recarga' },
  { value: 'sales_point', label: 'Punto de venta' },
  { value: 'both', label: 'Ambos' },
]

export default function CreateBranchModal({
  eventId,
  onCreated,
  onClose,
}: {
  eventId: string
  onCreated: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('sales_point')
  const [isActive, setIsActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('branches').insert({
      event_id: eventId,
      name: name.trim(),
      type,
      is_active: isActive,
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    onCreated()
    onClose()
  }

  return (
    <Modal title="Nueva sucursal" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Nombre</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Ej: Entrada norte"
          />
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
            {busy ? 'Creando…' : 'Crear sucursal'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
