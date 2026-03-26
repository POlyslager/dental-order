import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { X, Camera, Search, Minus, Plus, PackageMinus, Flashlight, FlashlightOff, RotateCcw, Check } from 'lucide-react'

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
]
const SCAN_DIV = 'entnehmen-scanner-div'

type SessionEntry = { id: string; name: string; qty: number; productId: string }

interface Props {
  onClose: () => void
  onSuccess: (summary: string) => void
}

export default function EntnehmenScanModal({ onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<'scan' | 'search'>('scan')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searchSelected, setSearchSelected] = useState<Product | null>(null)
  const [searchQty, setSearchQty] = useState(1)

  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const torchChecked = useRef(false)

  const [taking, setTaking] = useState(false)
  const [flashName, setFlashName] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [sessionLog, setSessionLog] = useState<SessionEntry[]>([])

  const [scanActive, setScanActive] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const startTokenRef = useRef(0)

  const [dragPos, setDragPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(16, Math.floor(window.innerWidth / 2) - 160) : 16,
    y: 90,
  }))
  const isDragging = useRef(false)
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 })

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!isDragging.current) return
      e.preventDefault()
      const point = 'touches' in e ? (e as TouchEvent).touches[0] : e as MouseEvent
      const dx = point.clientX - dragOrigin.current.mouseX
      const dy = point.clientY - dragOrigin.current.mouseY
      setDragPos({
        x: Math.max(0, Math.min(window.innerWidth - 320, dragOrigin.current.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 80, dragOrigin.current.posY + dy)),
      })
    }
    function onEnd() { isDragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('mouseup', onEnd)
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onEnd)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])

  function onDragStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const point = 'touches' in e ? e.touches[0] : e
    isDragging.current = true
    dragOrigin.current = { mouseX: point.clientX, mouseY: point.clientY, posX: dragPos.x, posY: dragPos.y }
  }

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('products').select('id, name, article_number, current_stock, min_stock, unit')
        .or(`name.ilike.%${query}%,article_number.ilike.%${query}%`)
        .gt('current_stock', 0)
        .order('name').limit(8)
      setResults((data as Product[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  async function startScanner() {
    const token = ++startTokenRef.current
    setScanActive(true)
    await new Promise(r => setTimeout(r, 150))
    if (token !== startTokenRef.current) return
    const el = document.getElementById(SCAN_DIV)
    if (el) el.innerHTML = ''
    try {
      const s = new Html5Qrcode(SCAN_DIV, { formatsToSupport: SCAN_FORMATS, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } })
      if (token !== startTokenRef.current) return
      scannerRef.current = s
      await s.start(
        { facingMode: 'environment' },
        { fps: 25, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.5 }) },
        async (raw) => {
          await s.stop()
          s.clear()
          scannerRef.current = null
          setScanActive(false)
          torchChecked.current = false
          setTorchSupported(false)
          setTorchOn(false)

          const clean = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
          const gtin = clean.match(/^01(\d{14})/)
          const raw14 = gtin ? gtin[1] : clean
          const barcode = raw14.length === 14 && raw14.startsWith('0') ? raw14.slice(1) : raw14

          const { data } = await supabase
            .from('products').select('id, name, current_stock, min_stock, unit')
            .eq('barcode', barcode).maybeSingle()

          if (!data) {
            setScanError(`Barcode nicht gefunden`)
            setTimeout(() => { setScanError(null); startScanner() }, 2000)
            return
          }
          if ((data as Product).current_stock <= 0) {
            setScanError(`${(data as Product).name} – kein Bestand`)
            setTimeout(() => { setScanError(null); startScanner() }, 2000)
            return
          }
          await autoTake(data as Product)
        },
        () => {}
      )
      try {
        const caps = s.getRunningTrackCameraCapabilities()
        if (caps.torchFeature().isSupported()) setTorchSupported(true)
        torchChecked.current = true
      } catch { /* torch not available */ }
    } catch { if (token === startTokenRef.current) setScanActive(false) }
  }

  async function toggleTorch() {
    if (!scannerRef.current) return
    try {
      const caps = scannerRef.current.getRunningTrackCameraCapabilities()
      await caps.torchFeature().apply(!torchOn)
      setTorchOn(v => !v)
    } catch { /* ignore */ }
  }

  function stopScanner() {
    startTokenRef.current++
    const s = scannerRef.current
    scannerRef.current = null
    setScanActive(false)
    if (s?.isScanning) s.stop().then(() => s.clear()).catch(() => {})
    else s?.clear()
  }

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
  }, [])

  function switchMode(m: 'scan' | 'search') {
    if (m === mode) return
    if (m === 'search') stopScanner()
    setMode(m)
    setSearchSelected(null)
    setSearchQty(1)
    if (m === 'scan') startScanner()
  }

  async function autoTake(product: Product, qty = 1) {
    setTaking(true)
    setFlashName(product.name)
    try {
      const res = await fetch('/api/take-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, quantity: qty }),
      })
      if (res.ok) {
        const entryId = Math.random().toString(36).slice(2)
        setSessionLog(prev => [{ id: entryId, name: product.name, qty, productId: product.id }, ...prev])
      } else {
        setScanError(`${product.name} – Fehler`)
        setTimeout(() => setScanError(null), 2000)
      }
    } catch {
      setScanError('Netzwerkfehler')
      setTimeout(() => setScanError(null), 2000)
    } finally {
      setTaking(false)
      setFlashName(null)
      if (mode === 'scan') startScanner()
    }
  }

  async function undoEntry(entry: SessionEntry) {
    const { data } = await supabase.from('products').select('current_stock').eq('id', entry.productId).single()
    if (!data) return
    await Promise.all([
      supabase.from('products').update({ current_stock: data.current_stock + entry.qty }).eq('id', entry.productId),
      supabase.from('stock_movements').insert({
        product_id: entry.productId, type: 'manual_in', quantity: entry.qty, scanned_by: '', notes: 'Rückgängig (Entnehmen)',
      }),
    ])
    setSessionLog(prev => prev.filter(e => e.id !== entry.id))
  }

  function handleDone() {
    if (sessionLog.length === 0) { onClose(); return }
    if (sessionLog.length === 1) onSuccess(sessionLog[0].name)
    else onSuccess(`${sessionLog.length} Artikel entnommen`)
  }

  return (
    <div
      className="fixed z-50 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden select-none"
      style={{ left: dragPos.x, top: dragPos.y, width: 320 }}
    >
      {/* Drag handle / header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-transparent cursor-grab active:cursor-grabbing touch-none"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      >
        <div className="flex items-center gap-2">
          <PackageMinus size={15} className="text-slate-400" />
          <span className="text-slate-700 dark:text-white text-sm font-medium">Entnehmen</span>
          {sessionLog.length > 0 && (
            <span className="bg-sky-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {sessionLog.length}
            </span>
          )}
        </div>
        <button
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onClick={handleDone}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors p-1 rounded"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800">
        <button onClick={() => switchMode('scan')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${mode === 'scan' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Camera size={14} /> Scannen
        </button>
        <button onClick={() => switchMode('search')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${mode === 'search' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
          <Search size={14} /> Suchen
        </button>
      </div>

      {mode === 'scan' ? (
        <>
          {/* Camera with flash overlay */}
          <div className="relative bg-slate-900" style={{ minHeight: 180 }}>
            <div id={SCAN_DIV} className="w-full" style={{ minHeight: 180 }} />
            {(flashName || scanError) && (
              <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 ${flashName ? 'bg-emerald-500/90' : 'bg-red-500/80'}`}>
                {flashName ? (
                  <>
                    <Check size={28} className="text-white mb-1.5" />
                    <p className="text-white text-sm font-semibold text-center px-4 leading-snug">{flashName}</p>
                  </>
                ) : (
                  <p className="text-white text-sm font-medium text-center px-4">{scanError}</p>
                )}
              </div>
            )}
          </div>
          {/* Status bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {taking ? 'Wird eingebucht…' : 'Barcode vor die Kamera halten'}
            </p>
            {torchSupported && (
              <button onClick={toggleTorch} className={`p-1 rounded transition-colors ${torchOn ? 'text-amber-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}>
                {torchOn ? <Flashlight size={15} /> : <FlashlightOff size={15} />}
              </button>
            )}
          </div>
        </>
      ) : (
        /* Search mode */
        <div className="p-3">
          {searchSelected ? (
            <>
              <button onClick={() => setSearchSelected(null)} className="text-xs text-slate-400 hover:text-slate-600 mb-3 flex items-center gap-1">
                ← {searchSelected.name}
              </button>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{searchSelected.name}</p>
              <p className="text-xs text-slate-400 mb-4">Bestand: {searchSelected.current_stock} {searchSelected.unit}</p>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Menge</span>
                <div className="flex items-center border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden">
                  <button onClick={() => setSearchQty(q => Math.max(1, q - 1))} disabled={searchQty <= 1}
                    className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                    <Minus size={14} />
                  </button>
                  <span className="w-12 text-center font-semibold text-slate-800 dark:text-slate-100">{searchQty}</span>
                  <button onClick={() => setSearchQty(q => Math.min(searchSelected.current_stock, q + 1))} disabled={searchQty >= searchSelected.current_stock}
                    className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <button
                onClick={async () => {
                  const p = searchSelected
                  setSearchSelected(null)
                  setQuery('')
                  await autoTake(p, searchQty)
                  setSearchQty(1)
                }}
                disabled={taking}
                className="w-full px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {taking ? 'Wird eingebucht…' : 'Entnehmen'}
              </button>
            </>
          ) : (
            <>
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Artikel suchen…" autoFocus
                className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              {results.length > 0 && (
                <div className="mt-2 border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
                  {results.map(p => (
                    <button key={p.id} onClick={() => { setSearchSelected(p); setSearchQty(1) }}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.name}</p>
                      <p className="text-xs text-slate-400">Bestand: {p.current_stock} {p.unit}</p>
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && results.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">Keine Artikel gefunden</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Session log */}
      {sessionLog.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-700 max-h-36 overflow-y-auto">
          {sessionLog.map(entry => (
            <div key={entry.id} className="flex items-center px-3 py-2 gap-2 border-b border-slate-50 dark:border-slate-800 last:border-0">
              <Check size={12} className="text-emerald-500 shrink-0" />
              <span className="flex-1 text-xs text-slate-700 dark:text-slate-300 truncate">{entry.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{entry.qty}×</span>
              <button onClick={() => undoEntry(entry)}
                className="text-slate-300 hover:text-red-400 dark:hover:text-red-400 transition-colors p-0.5 shrink-0"
                title="Rückgängig">
                <RotateCcw size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <span className="text-xs text-slate-400">
          {sessionLog.length > 0 ? `${sessionLog.length} entnommen` : 'Noch nichts entnommen'}
        </span>
        <button onClick={handleDone}
          className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          Fertig
        </button>
      </div>
    </div>
  )
}
