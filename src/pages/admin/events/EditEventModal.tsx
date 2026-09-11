import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal from '../staff/Modal'

type EventStatus = 'draft' | 'active' | 'closed'
type DeviceType = 'nfc' | 'qr' | 'hybrid'

interface Org {
  id: string
  name: string
  slug: string
}

interface EventRow {
  id: string
  org_id: string
  name: string
  slug: string
  status: string
  device_type: string
  currency: string
  brand_primary: string
  brand_secondary: string
}

const STATUSES = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
  { value: 'closed', label: 'Cerrado' },
] as const

const DEVICE_TYPES = [
  { value: 'qr', label: 'QR' },
  { value: 'nfc', label: 'NFC' },
  { value: 'hybrid', label: 'Híbrido' },
] as const

export default function EditEventModal({
  event,
  onSaved,
  onClose,
}: {
  event: EventRow
  onSaved: () => void
  onClose: () => void
}) {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgId] = useState(event.org_id)
  const [name, setName] = useState(event.name)
  const [slug, setSlug] = useState(event.slug)
  const [status, setStatus] = useState<EventStatus>(event.status as EventStatus)
  const [deviceType, setDeviceType] = useState<DeviceType>(event.device_type as DeviceType)
  const [currency, setCurrency] = useState(event.currency)
  const [brandPrimary, setBrandPrimary] = useState(event.brand_primary)
  const [brandSecondary, setBrandSecondary] = useState(event.brand_secondary)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('organizations')
      .select('id, name, slug')
      .then(({ data }) => {
        if (data) setOrgs(data)
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !name.trim() || !slug.trim()) {
      setError('Organización, nombre y slug son requeridos.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('events')
      .update({
        org_id: orgId,
        name: name.trim(),
        slug: slug.trim(),
        status,
        device_type: deviceType,
        currency,
        brand_primary: brandPrimary,
        brand_secondary: brandSecondary,
      })
      .eq('id', event.id)
    setBusy(false)
    if (updateError) {
      if (updateError.code === '23505') {
        setError('Ya existe otro evento con ese slug. Elige otro.')
      } else {
        setError(updateError.message)
      }
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Modal title="Editar evento" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="field">
          <label>Organización *</label>
          <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Seleccionar organización...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Nombre *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Slug *</label>
          <input className="input font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <p className="mt-1 text-xs text-ink-faint">URL: /e/{slug || '...'}/admin</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Estado</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Dispositivo</label>
            <select className="input" value={deviceType} onChange={(e) => setDeviceType(e.target.value as DeviceType)}>
              {DEVICE_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="field">
            <label>Moneda</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <div className="field">
            <label>Color primario</label>
            <input
              type="color"
              className="input h-10 cursor-pointer"
              value={brandPrimary}
              onChange={(e) => setBrandPrimary(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Color secundario</label>
            <input
              type="color"
              className="input h-10 cursor-pointer"
              value={brandSecondary}
              onChange={(e) => setBrandSecondary(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-sm text-rust">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="cta-solid max-w-[180px] text-sm" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  )
}