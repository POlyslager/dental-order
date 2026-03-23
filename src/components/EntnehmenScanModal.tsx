import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { X, Camera, Search, Minus, Plus, ChevronLeft } from 'lucide-react'

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.QR_CODE,
]
const SCAN_DIV = 'entnehmen-scanner-div'

interface Props {
  onClose: () => void
  onSuccess: (productName: string) => void
}

export default function EntnehmenScanModal({ onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<'search' | 'scan'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [selected, setSelected] = useState<Product | null>(null)
  const [qty, setQty] = useState(1)
  const [taking, setTaking] = useState(false)
  const [showSlowSpinner, setShowSlowSpinner] = useState(false)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scanActive, setScanActive] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('products').select('*')
        .or(`name.ilike.%${query}%,article_number.ilike.%${query}%`)
        .gt('current_stock', 0)
        .order('name').limit(8)
      setResults((data as Product[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  async function startScanner() {
    setScanActive(true)
    await new Promise(r => setTimeout(r, 150))
    try {
      const s = new Html5Qrcode(SCAN_DIV, { formatsToSupport: SCAN_FORMATS, verbose: false })
      scannerRef.current = s
      await s.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.5 }) },
        async (raw) => {
          await s.stop()
          scannerRef.current = null
          setScanActive(false)
          const clean = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
          const gtin = clean.match(/^01(\d{14})/)
          const barcode = gtin ? gtin[1] : clean
          const { data } = await supabase.from('products').select('*').eq('barcode', barcode).maybeSingle()
          if (data) { setSelected(data as Product); setQty(1) }
        },
        () => {}
      )
    } catch { setScanActive(false) }
  }

  function stopScanner() {
    scannerRef.current?.stop().catch(() => {})
    scannerRef.current = null
    setScanActive(false)
  }

  useEffect(() => () => { stopScanner() }, [])

  function switchMode(m: 'search' | 'scan') {
    if (m === mode) return
    if (scanActive) stopScanner()
    setMode(m)
    if (m === 'scan') startScanner()
  }

  async function handleEntnehmen() {
    if (!selected) return
    setTaking(true)
    slowTimer.current = setTimeout(() => setShowSlowSpinner(true), 5000)
    try {
      const res = await fetch('/api/take-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selected.id, quantity: qty }),
      })
      if (res.ok) { onSuccess(selected.name); onClose() }
    } finally {
      if (slowTimer.current) clearTimeout(slowTimer.current)
      setTaking(false)
      setShowSlowSpinner(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      {showSlowSpinner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
          <div className="w-14 h-14 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden h-[500px] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 shrink-0">
          {selected
            ? <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-sky-500 hover:text-sky-600 transition-colors"><ChevronLeft size={16} />Zurück</button>
            : <h2 className="font-semibold text-slate-800">Entnehmen</h2>
          }
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"><X size={20} /></button>
        </div>

        {selected ? (
          /* ── Product + qty ── */
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <p className="font-semibold text-slate-800 text-base mb-0.5">{selected.name}</p>
            <p className="text-sm text-slate-400 mb-5">
              {selected.preferred_supplier && <span>{selected.preferred_supplier} · </span>}
              Bestand: <span className="font-medium text-slate-600">{selected.current_stock} {selected.unit}</span>
            </p>
            {selected.current_stock <= 0 ? (
              <p className="text-sm text-red-500 text-center py-4">Kein Bestand verfügbar</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <span className="text-sm font-medium text-slate-700">Menge</span>
                  <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                    <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1}
                      className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors"><Minus size={14} /></button>
                    <span className="w-12 text-center font-semibold text-slate-800 select-none">{qty}</span>
                    <button onClick={() => setQty(q => Math.min(selected.current_stock, q + 1))} disabled={qty >= selected.current_stock}
                      className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors"><Plus size={14} /></button>
                  </div>
                </div>
                <button onClick={handleEntnehmen} disabled={taking}
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50">
                  {taking ? 'Wird gebucht…' : `${qty}× entnehmen`}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b border-slate-100 shrink-0">
              <button onClick={() => switchMode('search')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${mode === 'search' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                <Search size={14} /> Suchen
              </button>
              <button onClick={() => switchMode('scan')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${mode === 'scan' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                <Camera size={14} /> Scannen
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {mode === 'search' ? (
                <div className="p-4">
                  <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Artikel suchen…" autoFocus
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  {results.length > 0 && (
                    <div className="mt-2 border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
                      {results.map(p => (
                        <button key={p.id} onClick={() => { setSelected(p); setQty(1) }}
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors">
                          <p className="text-sm font-medium text-slate-800">{p.name}</p>
                          <p className="text-xs text-slate-400">Bestand: {p.current_stock} {p.unit}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {query.trim() && results.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-6">Keine Artikel gefunden</p>
                  )}
                </div>
              ) : (
                <div id={SCAN_DIV} className="w-full h-full bg-slate-900" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
