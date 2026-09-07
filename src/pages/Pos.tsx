import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { DeviceScanner } from '../components/DeviceScanner'
import { useEvent } from '../hooks/useEvent'
import { readFunctionErrorCode } from '../lib/functionError'
import { supabase } from '../lib/supabase'

type ChargeResult =
  | { ok: true; new_balance: number; tx_id: string }
  | { ok: false; error: 'not_found' | 'blocked' | 'insufficient_funds' | 'invalid_amount' | string }

const ERROR_LABEL: Record<string, string> = {
  not_found: 'Dispositivo no encontrado en este evento.',
  blocked: 'Dispositivo bloqueado o inactivo.',
  insufficient_funds: 'Saldo insuficiente.',
  invalid_amount: 'Monto inválido.',
  branch_not_assigned: 'Tu usuario no está asignado a esta sucursal.',
}

const TYPE_LABEL: Record<string, string> = { nfc: 'NFC', qr: 'QR', hybrid: 'NFC/QR' }

const QUICK_AMOUNTS = [500, 1000, 2000, 5000]
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']

function formatAmount(s: string): string {
  return s ? Number(s).toLocaleString('es-CR') : '0'
}

/**
 * Modo punto de venta (sección 8.3 del plan) — la pantalla más crítica del
 * producto. Solo llama a la Edge Function `charge` y refleja su resultado;
 * ninguna lógica de saldo vive en el cliente.
 */
export default function Pos() {
  const { eventSlug } = useParams()
  const { data: event } = useEvent(eventSlug)
  const [deviceUid, setDeviceUid] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [charging, setCharging] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  function pressKey(k: string) {
    if (k === '⌫') return setAmount((a) => a.slice(0, -1))
    if (k === '.' && amount.includes('.')) return
    setAmount((a) => (a + k).slice(0, 9))
  }

  async function handleCharge() {
    if (!event || !deviceUid || !amount) return
    setCharging(true)
    setFeedback(null)

    const clientTxId = crypto.randomUUID()
    const { data, error } = await supabase.functions.invoke<ChargeResult>('charge', {
      body: {
        event_id: event.id,
        device_uid: deviceUid,
        amount: Number(amount),
        client_tx_id: clientTxId,
      },
    })

    setCharging(false)

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

    navigator.vibrate?.(80)
    setFeedback({ kind: 'ok', text: `Cobrado. Nuevo saldo: ${data.new_balance}` })
    setAmount('')
    setDeviceUid(null)
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="ui-topbar">
        <b>Punto de venta</b>
        <span>
          <span className="mr-3 font-normal normal-case">{event?.name ?? eventSlug}</span>
          <span className="ui-online">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            en línea
          </span>
        </span>
      </header>

      {!deviceUid ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-faint/60 p-8">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">En espera de escaneo</p>
          <DeviceScanner deviceType={event?.device_type ?? 'qr'} onScan={setDeviceUid} />
        </div>
      ) : (
        <div className="card flex flex-col gap-2 p-4">
          <div className="flex items-center gap-3">
            <div className="avatar">{TYPE_LABEL[event?.device_type ?? 'qr']}</div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold">Dispositivo escaneado</span>
              <span className="font-mono text-xs text-ink-faint">
                {TYPE_LABEL[event?.device_type ?? 'qr']} · {deviceUid}
              </span>
            </div>
            <span className="ml-auto pill pill-gold">escaneado</span>
          </div>
          <button
            type="button"
            onClick={() => setDeviceUid(null)}
            className="self-start text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            Escanear otro
          </button>
        </div>
      )}

      <div className="card flex flex-col gap-3 p-4">
        <div className="amount-display">₡{formatAmount(amount)}</div>

        <div className="quick-row">
          {QUICK_AMOUNTS.map((v) => (
            <button key={v} type="button" onClick={() => setAmount(String(v))} className="quick-btn">
              ₡{v.toLocaleString('es-CR')}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button key={k} onClick={() => pressKey(k)} className={`key ${k === '⌫' ? 'text-ink-faint' : ''}`}>
              {k}
            </button>
          ))}
        </div>
      </div>

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
        onClick={handleCharge}
        disabled={!deviceUid || !amount || charging}
        className="cta-solid disabled:opacity-50"
      >
        {charging ? 'Cobrando…' : `Cobrar ₡${formatAmount(amount)}`}
      </button>
    </div>
  )
}
