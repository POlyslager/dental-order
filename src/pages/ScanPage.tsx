import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Product } from '../lib/types'

type ScanMode = 'in' | 'out'

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [scanning, setScanning] = useState(false)
  const [mode, setMode] = useState<ScanMode>('out')
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => stopScanner()
  }, [])

  async function startScanner() {
    setError(null)
    setScannedProduct(null)
    setStatus(null)
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    setScanning(true)

    try {
      await reader.decodeFromVideoDevice(null, videoRef.current!, async (result, err) => {
        if (result) {
          stopScanner()
          await handleBarcode(result.getText())
        }
        if (err && !(err.message?.includes('No MultiFormat'))) {
          console.debug(err)
        }
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Camera error')
      setScanning(false)
    }
  }

  function stopScanner() {
    readerRef.current?.reset()
    readerRef.current = null
    setScanning(false)
  }

  async function handleBarcode(barcode: string) {
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', barcode)
      .single()

    if (!data) {
      setError(`No product found for barcode: ${barcode}`)
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

    setStatus(`✓ ${scannedProduct.name}: stock updated to ${newStock} ${scannedProduct.unit}`)
    setScannedProduct(null)
    setQuantity(1)
  }

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">Barcode Scanner</h2>

      {/* Mode toggle */}
      <div className="flex rounded-lg overflow-hidden border border-slate-300">
        {(['out', 'in'] as ScanMode[]).map(m => (
          <button key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === m ? 'bg-sky-500 text-white' : 'bg-white text-slate-600'
            }`}
          >
            {m === 'out' ? '📤 Use item' : '📥 Receive delivery'}
          </button>
        ))}
      </div>

      {/* Camera */}
      <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover" />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={startScanner}
              className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-3 rounded-xl font-medium text-sm"
            >
              📷 Start scanning
            </button>
          </div>
        )}
        {scanning && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="border-2 border-sky-400 w-48 h-32 rounded-lg opacity-70" />
          </div>
        )}
      </div>

      {scanning && (
        <button onClick={stopScanner} className="w-full py-2 text-sm text-slate-600 border border-slate-300 rounded-lg">
          Cancel
        </button>
      )}

      {/* Found product */}
      {scannedProduct && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div>
            <p className="font-semibold text-slate-800">{scannedProduct.name}</p>
            <p className="text-sm text-slate-500">Current stock: {scannedProduct.current_stock} {scannedProduct.unit}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
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
              className="flex-1 bg-sky-500 hover:bg-sky-600 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              Confirm {mode === 'in' ? 'receipt' : 'usage'}
            </button>
            <button
              onClick={() => setScannedProduct(null)}
              className="px-4 border border-slate-300 rounded-lg text-sm text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status && <p className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">{status}</p>}
      {error && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">{error}</p>}
    </div>
  )
}
