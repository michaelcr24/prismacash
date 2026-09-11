import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal from '../staff/Modal'

const KINDS = [
  { value: 'nfc', label: 'NFC' },
  { value: 'qr', label: 'QR' },
  { value: 'hybrid', label: 'Híbrido' },
]

export default function CreateDeviceModal({
  eventId,
  onCreated,
  onClose,
}: {
  eventId: string
  onCreated: () => void
  onClose: () => void
}) {
  const [uid, setUid] = useState('')
  const [type, setType] = useState('qr')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .insert({ event_id: eventId, uid: uid.trim(), type })
      .select('id')
      .single()
    if (deviceError) {
      setBusy(false)
      setError(deviceError.message)
      return
    }

    const { error: walletError } = await supabase.from('wallets').insert({ device_id: device.id, balance: 0 })
    setBusy(false)
    if (walletError) {
      setError(walletError.message)
      return
    }
    onCreated()
    onClose()
  }

  return (
    <Modal title="Nuevo dispositivo" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>UID</label>
          <input
            className="input"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            required
            placeholder="Ej: 04A3F2B1C9"
          />
        </div>
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
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Creando…' : 'Crear dispositivo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}