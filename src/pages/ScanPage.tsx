import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Product } from '../lib/types'
import { Plus } from 'lucide-react'

type ScanMode = 'in' | 'out'

interface Props { onAddWithBarcode: (barcode: string) => void }

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
]

export default function ScanPage({ onAddWithBarcode }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [scanning, setScanning] = useState(false)
  const [mode, setMode] = useState<ScanMode>('out')
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawCode, setRawCode] = useState<string | null>(null)

  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  function cleanBarcode(raw: string): string {
    return raw.replace(/^\]d[0-9]/, '').replace(/^\$/, '').replace(/^[\x00-\x1F]+/, '').trim()
  }

  async function startScanner() {
    setError(null)
    setScannedProduct(null)
    setStatus(null)
    setRawCode(null)

    const scanner = new Html5Qrcode('qr-reader', { formatsToSupport: FORMATS, verbose: false })
    scannerRef.current = scanner
    setScanning(true)

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        async (text) => {
          await stopScanner()
          await handleBarcode(text)
        },
        () => { /* scanning frames, ignore per-frame errors */ }
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Kamera-Fehler')
      setScanning(false)
    }
  }

  async function stopScanner() {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop()
    }
    scannerRef.current = null
    setScanning(false)
  }

  async function handleBarcode(raw: string) {
    const barcode = cleanBarcode(raw)
    setRawCode(barcode)

    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', barcode)
      .single()

    if (!data) {
      setError(`Unbekannter Code: ${barcode}`)
      return
    }
    setScannedProduct(data)
  }

  async function confirmMovement() {
    if (!scannedProduct) return
    const user = await getCurrentUser()
    if (!user) return

    const movementType = mode === 'in' ? 'scan_in' : 'scan_out'
    const stockDelta = mode === 'in' ? quantity : -quantity
    const newStock = scannedProduct.current_stock + stockDelta

    const { error: moveErr } = await supabase.from('stock_movements').insert({
      product_id: scannedProduct.id,
      type: movementType,
      quantity,
      scanned_by: user.id,
    })
    if (moveErr) { setError(moveErr.message); return }

    const { error: stockErr } = await supabase
      .from('products')
      .update({ current_stock: newStock })
      .eq('id', scannedProduct.id)
    if (stockErr) { setError(stockErr.message); return }

    setStatus(`✓ ${scannedProduct.name}: Bestand aktualisiert auf ${newStock} ${scannedProduct.unit}`)
    setScannedProduct(null)
    setQuantity(1)
  }

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">Scanner</h2>

      {/* Mode toggle */}
      <div className="flex rounded-xl overflow-hidden border border-slate-300">
        {(['out', 'in'] as ScanMode[]).map(m => (
          <button key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === m ? 'bg-sky-500 text-white' : 'bg-white text-slate-600'
            }`}
          >
            {m === 'out' ? 'Artikel entnehmen' : 'Lieferung einbuchen'}
          </button>
        ))}
      </div>

      {/* Camera viewfinder */}
      <div className="relative bg-slate-900 rounded-2xl overflow-hidden" style={{ minHeight: 280 }}>
        <div id="qr-reader" className="w-full" />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={startScanner}
              className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-3 rounded-xl font-medium text-sm"
            >
              Kamera starten
            </button>
          </div>
        )}
      </div>

      {scanning && (
        <button onClick={stopScanner} className="w-full py-2.5 text-sm text-slate-600 border border-slate-300 rounded-xl">
          Abbrechen
        </button>
      )}

      {/* Found product */}
      {scannedProduct && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div>
            <p className="font-semibold text-slate-800">{scannedProduct.name}</p>
            <p className="text-sm text-slate-500">Aktueller Bestand: {scannedProduct.current_stock} {scannedProduct.unit}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Menge</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmMovement}
              className="flex-1 bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-2.5 text-sm font-medium"
            >
              {mode === 'in' ? 'Einbuchen' : 'Entnehmen'}
            </button>
            <button
              onClick={() => setScannedProduct(null)}
              className="px-4 border border-slate-300 rounded-xl text-sm text-slate-600"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {status && <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm">{status}</p>}

      {error && (
        <div className="space-y-2">
          <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm">{error}</p>
          {rawCode && (
            <button
              onClick={() => onAddWithBarcode(rawCode)}
              className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Als neuen Artikel hinzufügen
            </button>
          )}
        </div>
      )}
    </div>
  )
}
