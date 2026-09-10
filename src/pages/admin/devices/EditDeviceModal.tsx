import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal from '../staff/Modal'

const KINDS = [
  { value: 'nfc', label: 'NFC' },
  { value: 'qr', label: 'QR' },
  { value: 'hybrid', label: 'Híbrido' },
]

const STATUSES = [
  { value: 'unassigned', label: 'Sin asignar' },
  { value: 'active', label: 'Activo' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'retired', label: 'Retirado' },
]

export default function EditDeviceModal({
  device,
  onUpdated,
  onClose,
}: {
  device: { id: string; uid: string; type: string; status: string }
  onUpdated: () => void
  onClose: () => void
}) {
  const [type, setType] = useState(device.type)
  const [status, setStatus] = useState(device.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('devices')
      .update({ type, status })
      .eq('id', device.id)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onUpdated()
    onClose()
  }

  return (
    <Modal title={`Editar dispositivo ${device.uid}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Estado</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
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