import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { useEffect, useId, useState } from 'react'

type DeviceType = 'nfc' | 'qr' | 'hybrid'

interface DeviceScannerProps {
  /** `device_type` configurado en el evento (sección 2/8.2 del plan). */
  deviceType: DeviceType
  onScan: (uid: string) => void
}

/**
 * Lector de dispositivo NFC/QR. Web NFC (`NDEFReader`) solo existe en
 * Android/Chrome en contexto seguro; en cualquier otro navegador cae a QR
 * por cámara con html5-qrcode (sección 8.2 del plan).
 */
export function DeviceScanner({ deviceType, onScan }: DeviceScannerProps) {
  const nfcAvailable = typeof window !== 'undefined' && 'NDEFReader' in window
  const [mode, setMode] = useState<'nfc' | 'qr'>(deviceType === 'nfc' && nfcAvailable ? 'nfc' : 'qr')
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const qrRegionId = useId()
  const nfcUnsupported = mode === 'nfc' && !nfcAvailable

  useEffect(() => {
    if (!active || mode !== 'nfc' || !nfcAvailable || !window.NDEFReader) return
    let cancelled = false
    const reader = new window.NDEFReader()
    reader
      .scan()
      .then(() => {
        reader.onreading = (event) => {
          if (cancelled) return
          onScan(event.serialNumber)
        }
      })
      .catch((err: unknown) => setStatus(`No se pudo activar NFC: ${String(err)}`))
    return () => {
      cancelled = true
    }
  }, [active, mode, nfcAvailable, onScan])

  useEffect(() => {
    if (!active || mode !== 'qr') return
    let cancelled = false
    let started = false
    const html5Qr = new Html5Qrcode(qrRegionId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    })
    html5Qr
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
          if (cancelled) return
          onScan(decodedText)
        },
        () => {
          /* fallos de decodificación por frame — se ignoran, es normal mientras enfoca */
        },
      )
      .then(() => {
        started = true
        // el efecto ya se desmontó mientras start() estaba en vuelo (React
        // Strict Mode en dev) — pararlo ahora, si no la cámara se queda
        // encendida de fondo aunque el componente ya no exista.
        if (cancelled) html5Qr.stop().catch(() => {})
      })
      .catch((err: unknown) => setStatus(`No se pudo abrir la cámara: ${String(err)}`))

    return () => {
      cancelled = true
      // start() es async — si el efecto se desmonta antes de que resuelva,
      // stop() lanza "scanner is not running" de forma síncrona, no como
      // promesa rechazada, así que un simple .catch() no lo captura; por
      // eso solo se llama aquí cuando ya sabemos que sí arrancó.
      if (started) {
        html5Qr.stop().catch(() => {})
      }
    }
  }, [active, mode, qrRegionId, onScan])

  return (
    <div className="flex flex-col items-center gap-2">
      {deviceType === 'hybrid' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('nfc')
              setActive(false)
              setStatus(null)
            }}
            disabled={!nfcAvailable}
            className={`btn !px-3 !py-1.5 ${mode === 'nfc' ? 'border-marigold font-semibold text-marigold' : ''}`}
          >
            NFC
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('qr')
              setActive(false)
              setStatus(null)
            }}
            className={`btn !px-3 !py-1.5 ${mode === 'qr' ? 'border-marigold font-semibold text-marigold' : ''}`}
          >
            QR
          </button>
        </div>
      )}

      {mode === 'nfc' && nfcUnsupported ? (
        <p className="text-sm text-ink-faint">Web NFC no disponible en este navegador — usa QR.</p>
      ) : !active ? (
        <button
          type="button"
          onClick={() => setActive(true)}
          className="btn border-marigold text-marigold"
        >
          {mode === 'qr' ? 'Escanear código QR' : 'Escanear NFC'}
        </button>
      ) : mode === 'qr' ? (
        <>
          <div id={qrRegionId} className="w-[260px]" />
          <button
            type="button"
            onClick={() => setActive(false)}
            className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            Cancelar
          </button>
          {status && <p className="text-sm text-rust">{status}</p>}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-faint">{status ?? 'Esperando escaneo…'}</p>
          <button
            type="button"
            onClick={() => setActive(false)}
            className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            Cancelar
          </button>
        </>
      )}
    </div>
  )
}
