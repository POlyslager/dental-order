import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { X, Camera, Search, Minus, Plus, PackageMinus, Flashlight, FlashlightOff, RotateCcw, Check, ArrowLeft } from 'lucide-react'

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
  onAddWithBarcode?: (barcode: string) => void
}

export default function EntnehmenScanModal({ onClose, onSuccess, onAddWithBarcode }: Props) {
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

  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkResults, setLinkResults] = useState<Product[]>([])
  const [linking, setLinking] = useState(false)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const startTokenRef = useRef(0)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('products').select('id, name, article_number, current_stock, min_stock, unit, brand, preferred_supplier, last_price, category')
        .or(`name.ilike.%${query}%,article_number.ilike.%${query}%`)
        .gt('current_stock', 0)
        .order('name').limit(8)
      setResults((data as Product[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!linkMode || !linkQuery.trim()) { setLinkResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('products').select('id, name, article_number, current_stock, unit, brand, preferred_supplier, last_price, category')
        .or(`name.ilike.%${linkQuery}%,article_number.ilike.%${linkQuery}%`)
        .order('name').limit(10)
      setLinkResults((data as Product[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [linkQuery, linkMode])

  async function startScanner() {
    const token = ++startTokenRef.current
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
            setUnknownBarcode(barcode)
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
    } catch { /* scanner start failed */ }
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

  async function linkBarcodeToProduct(product: Product) {
    if (!unknownBarcode) return
    setLinking(true)
    const { error } = await supabase.from('products').update({ barcode: unknownBarcode }).eq('id', product.id)
    setLinking(false)
    if (!error) {
      setUnknownBarcode(null)
      setLinkMode(false)
      setLinkQuery('')
      setLinkResults([])
      setFlashName(`${product.name} – Barcode verknüpft`)
      setTimeout(() => { setFlashName(null); startScanner() }, 1800)
    }
  }

  function dismissUnknownBarcode() {
    setUnknownBarcode(null)
    setLinkMode(false)
    setLinkQuery('')
    setLinkResults([])
    startScanner()
  }

  function handleDone() {
    if (sessionLog.length === 0) { onClose(); return }
    if (sessionLog.length === 1) onSuccess(sessionLog[0].name)
    else onSuccess(`${sessionLog.length} Artikel entnommen`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleDone}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: 320 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-transparent">
          <div className="flex items-center gap-2">
            <PackageMinus size={15} className="text-slate-400" />
            <span className="text-slate-700 dark:text-white text-sm font-medium">Entnehmen</span>
            {sessionLog.length > 0 && (
              <span className="bg-sky-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                {sessionLog.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                className={`p-1 rounded transition-colors ${torchOn ? 'text-amber-400' : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'}`}
              >
                {torchOn ? <Flashlight size={16} /> : <FlashlightOff size={16} />}
              </button>
            )}
            <button onClick={handleDone} className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors p-1 rounded">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={() => switchMode('scan')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${mode === 'scan' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <Camera size={14} /> Scannen
          </button>
          <button
            onClick={() => switchMode('search')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors ${mode === 'search' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <Search size={14} /> Suchen
          </button>
        </div>

        {mode === 'scan' ? (
          <>
            {unknownBarcode ? (
              /* Unknown barcode — choice or link search */
              <div className="bg-slate-900 px-4 py-5" style={{ minHeight: 220 }}>
                {!linkMode ? (
                  <div className="flex flex-col gap-3 justify-center" style={{ minHeight: 180 }}>
                    <div className="text-center">
                      <p className="text-white text-sm font-semibold mb-1">Barcode nicht gefunden</p>
                      <p className="text-slate-400 text-xs font-mono truncate">{unknownBarcode}</p>
                    </div>
                    {onAddWithBarcode && (
                      <button
                        onClick={() => { onAddWithBarcode(unknownBarcode); onClose() }}
                        className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
                      >
                        Neuen Artikel anlegen
                      </button>
                    )}
                    <button
                      onClick={() => setLinkMode(true)}
                      className="w-full bg-slate-700 hover:bg-slate-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
                    >
                      Mit vorhandenem Artikel verknüpfen
                    </button>
                    <button
                      onClick={dismissUnknownBarcode}
                      className="text-slate-400 hover:text-slate-200 text-xs text-center transition-colors"
                    >
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2" style={{ minHeight: 180 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={() => { setLinkMode(false); setLinkQuery(''); setLinkResults([]) }} className="text-slate-400 hover:text-white transition-colors p-0.5">
                        <ArrowLeft size={15} />
                      </button>
                      <p className="text-white text-xs font-medium">Artikel suchen & verknüpfen</p>
                    </div>
                    <input
                      type="text"
                      value={linkQuery}
                      onChange={e => setLinkQuery(e.target.value)}
                      placeholder="Name oder Artikelnummer…"
                      autoFocus
                      className="w-full border border-slate-600 bg-slate-800 text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    {linkResults.length > 0 && (
                      <div className="border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-700 max-h-40 overflow-y-auto">
                        {linkResults.map(p => (
                          <button
                            key={p.id}
                            onClick={() => linkBarcodeToProduct(p)}
                            disabled={linking}
                            className="w-full text-left px-3 py-2.5 hover:bg-slate-700 transition-colors disabled:opacity-50"
                          >
                            <p className="text-sm font-medium text-white leading-tight mb-0.5">{p.name}</p>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {p.category && <span className="text-xs text-slate-400">{p.category}</span>}
                              {p.brand && <span className="text-xs text-slate-400">{p.brand}</span>}
                              {p.preferred_supplier && <span className="text-xs text-slate-400">{p.preferred_supplier}</span>}
                              {p.last_price != null && <span className="text-xs text-slate-400">€ {p.last_price.toFixed(2).replace('.', ',')}</span>}
                              {p.article_number && <span className="text-xs text-slate-400">{p.article_number}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {linking && <p className="text-xs text-slate-400 text-center py-2">Wird verknüpft…</p>}
                    {linkQuery.trim() && !linking && linkResults.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-2">Keine Artikel gefunden</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Normal camera view */
              <div className="relative bg-slate-900" style={{ minHeight: 220 }}>
                <div id={SCAN_DIV} className="w-full" style={{ minHeight: 220 }} />
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
            )}

            {/* Status bar */}
            {!unknownBarcode && (
              <div className="px-3 py-2 bg-slate-100 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {taking ? 'Wird eingebucht…' : 'Barcode vor die Kamera halten'}
                </p>
              </div>
            )}
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
                    <button
                      onClick={() => setSearchQty(q => Math.max(1, q - 1))}
                      disabled={searchQty <= 1}
                      className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-12 text-center font-semibold text-slate-800 dark:text-slate-100">{searchQty}</span>
                    <button
                      onClick={() => setSearchQty(q => Math.min(searchSelected.current_stock, q + 1))}
                      disabled={searchQty >= searchSelected.current_stock}
                      className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                    >
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
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Artikel suchen…"
                  autoFocus
                  className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {results.length > 0 && (
                  <div className="mt-2 border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
                    {results.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSearchSelected(p); setSearchQty(1) }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 mb-0.5">{p.name}</p>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          <span className="text-xs text-slate-400">Bestand: {p.current_stock} {p.unit}</span>
                          {p.category && <span className="text-xs text-slate-400">{p.category}</span>}
                          {p.brand && <span className="text-xs text-slate-400">{p.brand}</span>}
                          {p.preferred_supplier && <span className="text-xs text-slate-400">{p.preferred_supplier}</span>}
                          {p.last_price != null && <span className="text-xs text-slate-400">€ {p.last_price.toFixed(2).replace('.', ',')}</span>}
                        </div>
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
                <button
                  onClick={() => undoEntry(entry)}
                  className="text-slate-300 hover:text-red-400 dark:hover:text-red-400 transition-colors p-0.5 shrink-0"
                  title="Rückgängig"
                >
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
          <button
            onClick={handleDone}
            className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  )
}
