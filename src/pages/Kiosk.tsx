import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DeviceScanner } from '../components/DeviceScanner'
import { useEvent } from '../hooks/useEvent'
import { readFunctionErrorCode } from '../lib/functionError'
import { supabase } from '../lib/supabase'
import { useSessionRole } from '../hooks/useSessionRole'

type Mode = 'new' | 'topup' | 'replace'

type IssueResult = { ok: true; device_id: string; balance: number } | { ok: false; error: string }
type TopupResult = { ok: true; new_balance: number; tx_id: string } | { ok: false; error: string }
type ReplaceResult =
  | { ok: true; new_device_id: string; balance: number; replayed?: boolean }
  | { ok: false; error: string }

const ERROR_LABEL: Record<string, string> = {
  uid_taken: 'Ese dispositivo ya está asignado a otro asistente.',
  attendee_not_found: 'Asistente no encontrado.',
  invalid_amount: 'Monto inválido.',
  branch_not_assigned: 'Tu usuario no está asignado a esta sucursal.',
  not_found: 'Dispositivo no encontrado en este evento.',
  blocked: 'Dispositivo bloqueado o inactivo.',
  already_retired: 'El dispositivo ya está retirado.',
}

const QUICK_AMOUNTS = ['5000', '10000', '20000']

const MODES: { value: Mode; label: string }[] = [
  { value: 'new', label: 'Nuevo' },
  { value: 'topup', label: 'Recargar' },
  { value: 'replace', label: 'Reemplazar' },
]

/**
 * Modo quiosco (sección 8.3/8.7 del plan): registro de asistente + alta de
 * dispositivo nuevo (`issue-device`), recarga de saldo a un dispositivo ya
 * emitido (`topup`) cuando el asistente ya trae su pulsera/QR, y bloqueo +
 * reemplazo de un dispositivo extraviado (`block-and-replace`, sección 5.3)
 * migrando el saldo a uno nuevo.
 */
export default function Kiosk() {
  const { eventSlug } = useParams()
  const role = useSessionRole()
  const { data: event } = useEvent(eventSlug)
  const [mode, setMode] = useState<Mode>('new')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [deviceUid, setDeviceUid] = useState<string | null>(null)
  const [oldDeviceUid, setOldDeviceUid] = useState<string | null>(null)
  const [amount, setAmount] = useState('10000')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setDeviceUid(null)
    setOldDeviceUid(null)
    setFeedback(null)
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (mode === 'replace') {
      void handleReplace()
      return
    }
    void handleIssueOrTopup()
  }

  async function handleReplace() {
    if (!event || !oldDeviceUid || !deviceUid) return
    setSubmitting(true)
    setFeedback(null)

    const { data, error } = await supabase.functions.invoke<ReplaceResult>('block-and-replace', {
      body: {
        event_id: event.id,
        old_device_uid: oldDeviceUid,
        new_device_uid: deviceUid,
        new_device_type: event.device_type === 'hybrid' ? 'qr' : event.device_type,
        client_tx_id: crypto.randomUUID(),
      },
    })

    setSubmitting(false)

    if (error) {
      const code = await readFunctionErrorCode(error)
      setFeedback({
        kind: 'error',
        text: code ? (ERROR_LABEL[code] ?? code) : 'Error de conexión — intenta de nuevo.',
      })
      return
    }
    if (!data || !data.ok) {
      setFeedback({ kind: 'error', text: ERROR_LABEL[data?.error ?? ''] ?? data?.error ?? 'Error desconocido.' })
      return
    }

    setFeedback({
      kind: 'ok',
      text: data.replayed
        ? 'Operación ya registrada (no se duplicó).'
        : `Dispositivo extraviado bloqueado. Saldo migrado: ${data.balance}.`,
    })
    setOldDeviceUid(null)
    setDeviceUid(null)
  }

  async function handleIssueOrTopup() {
    if (!event || !deviceUid) return
    setSubmitting(true)
    setFeedback(null)

    const { data, error } =
      mode === 'new'
        ? await supabase.functions.invoke<IssueResult>('issue-device', {
            body: {
              event_id: event.id,
              device_uid: deviceUid,
              device_type: event.device_type === 'hybrid' ? 'qr' : event.device_type,
              attendee_name: name,
              attendee_phone: phone,
              initial_amount: Number(amount) || 0,
              client_tx_id: crypto.randomUUID(),
            },
          })
        : await supabase.functions.invoke<TopupResult>('topup', {
            body: {
              event_id: event.id,
              device_uid: deviceUid,
              amount: Number(amount) || 0,
              client_tx_id: crypto.randomUUID(),
            },
          })

    setSubmitting(false)

    if (error) {
      const code = await readFunctionErrorCode(error)
      setFeedback({
        kind: 'error',
        text: code ? (ERROR_LABEL[code] ?? code) : 'Error de conexión — intenta de nuevo.',
      })
      return
    }
    if (!data || !data.ok) {
      setFeedback({ kind: 'error', text: ERROR_LABEL[data?.error ?? ''] ?? data?.error ?? 'Error desconocido.' })
      return
    }

    const newBalance = 'balance' in data ? data.balance : data.new_balance
    setFeedback({
      kind: 'ok',
      text:
        mode === 'new'
          ? `Dispositivo activado con saldo ${newBalance}.`
          : `Recarga exitosa. Nuevo saldo: ${newBalance}.`,
    })
    setName('')
    setPhone('')
    setDeviceUid(null)
    setAmount('10000')
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="ui-topbar">
        {role === 'super_admin' && (
          <Link to={`/e/${eventSlug}/admin`} className="text-xs font-bold uppercase tracking-wider text-ink-soft hover:text-violet">
            ← Dashboard
          </Link>
        )}
        <b>Quiosco de recarga</b>
        <span>
          <span className="mr-3 font-normal normal-case">{event?.name ?? eventSlug}</span>
          <span className="ui-online">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            en línea
          </span>
        </span>
      </header>

      <div className="flex gap-1.5" role="tablist" aria-label="Modo del quiosco">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={mode === m.value}
            onClick={() => switchMode(m.value)}
            className={`flex-1 rounded-full border px-2 py-2 text-sm font-bold transition ${
              mode === m.value
                ? 'border-transparent bg-lilac text-violet-deep'
                : 'border-line bg-white text-ink-soft hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-4">
        {mode === 'new' && (
          <>
            <div className="field">
              <label>Nombre del asistente</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className="input" />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
            </div>
          </>
        )}

        {mode === 'replace' ? (
          <>
            {!oldDeviceUid ? (
              <ScanBox
                title="Dispositivo extraviado"
                hint="Escanea la pulsera/QR que se quiere bloquear."
                deviceType={event?.device_type ?? 'qr'}
                onScan={setOldDeviceUid}
              />
            ) : (
              <DeviceAssigned label="Dispositivo a bloquear" uid={oldDeviceUid} onClear={() => setOldDeviceUid(null)} />
            )}

            {!deviceUid ? (
              <ScanBox
                title="Nuevo dispositivo"
                hint="Escanea el reemplazo que recibirá el saldo."
                deviceType={event?.device_type ?? 'qr'}
                onScan={setDeviceUid}
              />
            ) : (
              <DeviceAssigned label="Nuevo dispositivo" uid={deviceUid} onClear={() => setDeviceUid(null)} />
            )}
          </>
        ) : (
          <>
            {deviceUid ? (
              <DeviceAssigned label="Dispositivo" uid={deviceUid} onClear={() => setDeviceUid(null)} />
            ) : (
              <ScanBox
                title={mode === 'new' ? 'Nuevo dispositivo' : 'Dispositivo a recargar'}
                hint={
                  mode === 'new'
                    ? 'Escanea la pulsera/QR que se va a activar.'
                    : 'Escanea la pulsera/QR que ya trae el asistente.'
                }
                deviceType={event?.device_type ?? 'qr'}
                onScan={setDeviceUid}
              />
            )}

            <div className="field">
              <label>{mode === 'new' ? 'Monto inicial' : 'Monto a recargar'}</label>
              <div className="mt-0.5 flex gap-2">
                {QUICK_AMOUNTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(v)}
                    className={`quick-btn ${
                      amount === v ? 'border-marigold bg-marigold-bg font-semibold text-marigold' : ''
                    }`}
                  >
                    ₡{Number(v).toLocaleString('es-CR')}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {feedback && (
          <p
            className={`rounded-md border px-3 py-2 text-center text-sm font-medium ${
              feedback.kind === 'ok' ? 'border-signal/30 bg-signal-bg text-signal' : 'border-rust/30 bg-rust-bg text-rust'
            }`}
          >
            {feedback.text}
          </p>
        )}

        <button
          type="submit"
          disabled={!deviceUid || (mode === 'replace' ? !oldDeviceUid : false) || submitting}
          className={`${
            mode === 'new' ? 'cta-gold' : mode === 'replace' ? 'cta-coral' : 'cta-solid'
          } disabled:opacity-50`}
        >
          {submitting
            ? mode === 'replace'
              ? 'Bloqueando y migrando…'
              : mode === 'new'
                ? 'Activando…'
                : 'Recargando…'
            : mode === 'replace'
              ? 'Bloquear y migrar saldo'
              : mode === 'new'
                ? `Activar y cobrar ₡${Number(amount || 0).toLocaleString('es-CR')}`
                : `Recargar ₡${Number(amount || 0).toLocaleString('es-CR')}`}
        </button>
      </form>

      {mode !== 'replace' && (
        <button type="button" onClick={() => switchMode('replace')} className="cta-ghost">
          Perdió su dispositivo — bloquear y reemplazar
        </button>
      )}
    </div>
  )
}

type DeviceType = 'nfc' | 'qr' | 'hybrid'

function ScanBox({
  title,
  hint,
  deviceType,
  onScan,
}: {
  title: string
  hint: string
  deviceType: DeviceType
  onScan: (uid: string) => void
}) {
  const glyph = deviceType === 'nfc' ? '◉' : '▣'
  return (
    <div className="scan-shell flex flex-col gap-2">
      <div className="lens" style={{ width: 90, height: 90 }}>
        <span className="grid h-full w-full place-items-center text-4xl text-violet">{glyph}</span>
      </div>
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="text-xs text-ink-soft">{hint}</p>
      <div className="mt-1 flex justify-center">
        <DeviceScanner deviceType={deviceType} onScan={onScan} />
      </div>
    </div>
  )
}

function DeviceAssigned({ label, uid, onClear }: { label: string; uid: string; onClear: () => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="mt-0.5 flex items-center justify-between gap-2 rounded-md border border-line bg-paper-raised px-3 py-2">
        <span className="truncate font-mono text-xs text-ink">{uid}</span>
        <button type="button" onClick={onClear} className="flex-none text-xs text-ink-faint underline underline-offset-2 hover:text-ink">
          Escanear otro
        </button>
      </div>
    </div>
  )
}
