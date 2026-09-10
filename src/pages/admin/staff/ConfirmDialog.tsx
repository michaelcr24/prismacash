import Modal from './Modal'

export default function ConfirmDialog({
  title,
  message,
  items = [],
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  items?: string[]
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-ink-soft">{message}</p>
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item} className="chip">
              {item}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'cta-coral max-w-[180px] text-sm' : 'cta-solid max-w-[180px] text-sm'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
