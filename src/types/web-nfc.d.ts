// Web NFC API — no forma parte de lib.dom.d.ts todavía. Solo Android/Chrome
// en contexto seguro (sección 8.2 del plan); todo uso debe hacer feature-detect
// con `'NDEFReader' in window` antes de instanciar.
interface NDEFReadingEvent extends Event {
  serialNumber: string
  message: unknown
}

interface NDEFReader extends EventTarget {
  scan(): Promise<void>
  onreading: ((this: NDEFReader, ev: NDEFReadingEvent) => void) | null
}

interface Window {
  NDEFReader?: { new (): NDEFReader }
}
