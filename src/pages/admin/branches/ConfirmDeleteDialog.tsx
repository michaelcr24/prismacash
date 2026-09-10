import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import ConfirmDialog from '../staff/ConfirmDialog'

export default function ConfirmDeleteDialog({
  branch,
  terminalCount,
  onDeleted,
  onClose,
}: {
  branch: { id: string; name: string }
  terminalCount: number
  onDeleted: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items: string[] = []
  if (terminalCount > 0) items.push(`${terminalCount} terminal(es) asociada(s) se eliminarán también`)

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('branches').delete().eq('id', branch.id)
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
      title="Eliminar sucursal"
      message={`¿Eliminar "${branch.name}"? Esta acción no se puede deshacer.`}
      items={items}
      confirmLabel="Eliminar"
      cancelLabel="Cancelar"
      danger
      busy={busy}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  )
}