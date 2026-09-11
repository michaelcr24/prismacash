import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import ConfirmDialog from '../staff/ConfirmDialog'

export default function ConfirmDeleteEventDialog({
  eventId,
  eventName,
  onDeleted,
  onClose,
}: {
  eventId: string
  eventName: string
  onDeleted: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = [
    'Se eliminarán también sucursales, dispositivos, billeteras y transacciones (cascada).',
    'Esta acción es irreversible.',
  ]

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('events').delete().eq('id', eventId)
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    onDeleted()
    onClose()
  }

  return (
    <ConfirmDialog
      title="Eliminar evento"
      message={`¿Eliminar "${eventName}"?`}
      items={items}
      confirmLabel={busy ? 'Eliminando…' : 'Eliminar evento'}
      cancelLabel="Cancelar"
      danger
      busy={busy}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  )
}