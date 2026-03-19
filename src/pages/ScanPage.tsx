import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Order, Product } from '../lib/types'
import { Plus, Check, X, PackageCheck, ScanLine, Search, ShoppingCart } from 'lucide-react'

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
  const [quantity, setQuantity] = useState('1')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawCode, setRawCode] = useState<string | null>(null)

  // Artikel entnehmen: reorder prompt
  const [reorderPrompt, setReorderPrompt] = useState<{ product: Product; qty: string } | null>(null)
  const [addingToCart, setAddingToCart] = useState(false)
  const [addedToCart, setAddedToCart] = useState(false)

  // Lieferung einbuchen: open orders
  const [openOrders, setOpenOrders] = useState<Order[]>([])
  const [receivedItems, setReceivedItems] = useState<Set<string>>(new Set())
  const [matchedItem, setMatchedItem] = useState<{ orderId: string; itemId: string; expectedQty: number } | null>(null)

  // Manual search (scan_out fallback)
  const [manualSearch, setManualSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])

  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  useEffect(() => {
    if (mode === 'in') fetchOpenOrders()
  }, [mode])

  async function fetchOpenOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, items:order_items(*, product:products(*))')
      .eq('status', 'ordered')
      .order('created_at', { ascending: false })
    setOpenOrders((data as unknown as Order[]) ?? [])
  }

  async function searchProducts(q: string) {
    setManualSearch(q)
    if (!q.trim()) { setSearchResults([]); return }
    const { data } = await supabase.from('products').select('*')
      .ilike('name', `%${q}%`).order('name').limit(8)
    setSearchResults(data ?? [])
  }

  function selectProductManually(product: Product) {
    setSearchResults([])
    setError(null)

    // For scan_in: check if product is in an open order
    if (mode === 'in') {
      for (const order of openOrders) {
        for (const item of order.items ?? []) {
          if (item.product_id === product.id && !receivedItems.has(item.id)) {
            setMatchedItem({ orderId: order.id, itemId: item.id, expectedQty: item.quantity })
            setQuantity(String(item.quantity))
            setScannedProduct(product)
            return
          }
        }
      }
      setMatchedItem(null)
    }

    setScannedProduct(product)
    setQuantity('1')
  }

  function selectOrderItemManually(orderId: string, itemId: string, product: Product, qty: number) {
    setScannedProduct(product)
    setMatchedItem({ orderId, itemId, expectedQty: qty })
    setQuantity(String(qty))
  }

  function cleanBarcode(raw: string): string {
    // Strip AIM identifier (]d2, ]C1, etc.), then remove all non-printable chars
    const code = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
    // GS1 Data Matrix: extract just the GTIN from the (01) application identifier
    const gs1 = code.match(/^01(\d{14})/)
    if (gs1) return gs1[1]
    return code
  }

  async function startScanner() {
    setError(null)
    setScannedProduct(null)
    setStatus(null)
    setRawCode(null)
    setMatchedItem(null)

    const scanner = new Html5Qrcode('qr-reader', { formatsToSupport: FORMATS, verbose: false })
    scannerRef.current = scanner
    setScanning(true)

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.85, height: Math.min(w, h) * 0.85 }) },
        async (text) => {
          await stopScanner()
          await handleBarcode(text)
        },
        () => {}
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
      .from('products').select('*').eq('barcode', barcode).single()

    if (!data) {
      setError(`Unbekannter Code: ${barcode}`)
      return
    }

    setScannedProduct(data)

    // For scan_in: find matching unscanned order item
    if (mode === 'in') {
      for (const order of openOrders) {
        for (const item of order.items ?? []) {
          if (item.product_id === data.id && !receivedItems.has(item.id)) {
            setMatchedItem({ orderId: order.id, itemId: item.id, expectedQty: item.quantity })
            setQuantity(String(item.quantity))
            return
          }
        }
      }
      setMatchedItem(null)
      setQuantity('1')
    } else {
      setQuantity('1')
    }
  }

  async function confirmMovement() {
    if (!scannedProduct) return
    const user = await getCurrentUser()
    if (!user) return

    const qty = parseInt(quantity) || 0
    const movementType = mode === 'in' ? 'scan_in' : 'scan_out'
    const stockDelta = mode === 'in' ? qty : -qty
    const newStock = scannedProduct.current_stock + stockDelta

    const { error: moveErr } = await supabase.from('stock_movements').insert({
      product_id: scannedProduct.id,
      type: movementType,
      quantity: qty,
      scanned_by: user.id,
    })
    if (moveErr) { setError(moveErr.message); return }

    const { error: stockErr } = await supabase
      .from('products').update({ current_stock: newStock }).eq('id', scannedProduct.id)
    if (stockErr) { setError(stockErr.message); return }

    if (mode === 'out') {
      setStatus(`✓ ${scannedProduct.name}: Bestand aktualisiert auf ${newStock} ${scannedProduct.unit}`)

      if (newStock <= scannedProduct.min_stock) {
        const defaultQty = Math.max(1, Math.ceil(scannedProduct.min_stock * 1.5))
        const since = new Date()
        since.setDate(since.getDate() - 60)
        const { data: movements } = await supabase
          .from('stock_movements').select('quantity')
          .eq('product_id', scannedProduct.id).eq('type', 'scan_out')
          .gte('created_at', since.toISOString())
        const velocityQty = movements && movements.length > 0
          ? Math.ceil((movements.reduce((s, m) => s + m.quantity, 0) / 60) * 42)
          : 0
        setReorderPrompt({ product: scannedProduct, qty: String(Math.max(velocityQty, defaultQty)) })
        setAddedToCart(false)
      }
    } else {
      // scan_in: mark item and check if order is complete
      if (matchedItem) {
        const updated = new Set(receivedItems).add(matchedItem.itemId)
        setReceivedItems(updated)

        const order = openOrders.find(o => o.id === matchedItem.orderId)
        if (order) {
          const allDone = (order.items ?? []).every(i => updated.has(i.id))
          if (allDone) {
            await supabase.from('orders').update({ status: 'received' }).eq('id', order.id)
            setOpenOrders(prev => prev.filter(o => o.id !== order.id))
            setStatus(`✓ Bestellung von ${order.supplier ?? 'Lieferant'} vollständig erhalten`)
          } else {
            setStatus(`✓ ${scannedProduct.name} eingebucht`)
          }
        }
      } else {
        setStatus(`✓ ${scannedProduct.name}: Bestand aktualisiert auf ${newStock} ${scannedProduct.unit}`)
      }
      setMatchedItem(null)
    }

    setScannedProduct(null)
    setQuantity('1')
  }

  async function addReorderToCart() {
    if (!reorderPrompt) return
    setAddingToCart(true)
    const reorderQty = parseInt(reorderPrompt.qty) || 1
    const user = await getCurrentUser()
    if (user) {
      const { data: existing } = await supabase
        .from('cart_items').select('id, quantity')
        .eq('product_id', reorderPrompt.product.id).maybeSingle()
      if (existing) {
        await supabase.from('cart_items')
          .update({ quantity: existing.quantity + reorderQty }).eq('id', existing.id)
      } else {
        await supabase.from('cart_items')
          .insert({ product_id: reorderPrompt.product.id, quantity: reorderQty, added_by: user.id })
      }
    }
    setAddingToCart(false)
    setAddedToCart(true)
  }

  const pendingItemCount = openOrders.reduce((s, o) =>
    s + (o.items ?? []).filter(i => !receivedItems.has(i.id)).length, 0)

  return (
    <div className="max-w-md mx-auto">

      {/* Mode toggle */}
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10">
        {(['out', 'in'] as ScanMode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setScannedProduct(null); setError(null); setStatus(null) }}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${
              mode === m ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500'
            }`}>
            {m === 'out' ? <><ScanLine size={15} /> Artikel entnehmen</> : <><PackageCheck size={15} /> Lieferung einbuchen</>}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">

        {/* Camera viewfinder */}
        <div className="relative bg-slate-900 rounded-2xl overflow-hidden" style={{ minHeight: 280 }}>
          <div id="qr-reader" className="w-full" />
          {!scanning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button onClick={startScanner}
                className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-3 rounded-xl font-medium text-sm">
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

        {/* Manual search */}
        <div className="space-y-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={manualSearch}
              onChange={e => searchProducts(e.target.value)}
              placeholder={mode === 'in' ? 'Artikel oder Lieferant suchen…' : 'Artikel manuell suchen…'}
              className="w-full border border-slate-300 rounded-xl pl-9 pr-9 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            />
            {manualSearch && (
              <button type="button" onClick={() => { setManualSearch(''); setSearchResults([]) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={15} />
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50 overflow-hidden">
              {searchResults.map(p => (
                <button key={p.id} onClick={() => selectProductManually(p)}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors">
                  <p className="text-sm font-medium text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{p.category} · {p.current_stock} {p.unit}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Lieferung einbuchen: open orders list ── */}
        {mode === 'in' && !scannedProduct && (
          openOrders.length === 0 ? (
            <div className="text-center py-8">
              <PackageCheck size={32} className="mx-auto text-slate-200 mb-2" />
              <p className="text-sm text-slate-400">Keine offenen Bestellungen</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                {pendingItemCount} Artikel ausstehend
              </p>
              {openOrders.filter(order =>
                !manualSearch.trim() ||
                order.supplier?.toLowerCase().includes(manualSearch.toLowerCase()) ||
                (order.items ?? []).some(i => i.product?.name.toLowerCase().includes(manualSearch.toLowerCase()))
              ).map(order => {
                const items = order.items ?? []
                const allDone = items.every(i => receivedItems.has(i.id))
                return (
                  <div key={order.id} className={`rounded-2xl border overflow-hidden ${allDone ? 'border-emerald-200' : 'border-slate-200'}`}>
                    <div className={`px-4 py-2.5 flex items-center justify-between ${allDone ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                      <p className="text-sm font-semibold text-slate-800">{order.supplier ?? 'Lieferant'}</p>
                      {allDone
                        ? <Check size={16} className="text-emerald-500" />
                        : <span className="text-xs text-slate-400">{items.filter(i => !receivedItems.has(i.id)).length} / {items.length} ausstehend</span>
                      }
                    </div>
                    <div className="divide-y divide-slate-50 bg-white">
                      {items.map(item => {
                        const done = receivedItems.has(item.id)
                        return (
                          <button key={item.id} disabled={done}
                            onClick={() => item.product && selectOrderItemManually(order.id, item.id, item.product, item.quantity)}
                            className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors ${done ? 'opacity-40' : 'hover:bg-slate-50 active:bg-slate-100'}`}>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'
                            }`}>
                              {done && <Check size={11} className="text-white" />}
                            </div>
                            <p className={`text-sm flex-1 ${done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {item.product?.name ?? '—'}
                            </p>
                            <span className="text-xs text-slate-400 shrink-0">{item.quantity}×</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* Scanned product confirmation */}
        {scannedProduct && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-in-up">
            {/* Product name — prominent visual check */}
            <div className="px-4 py-4 border-b border-slate-100">
              <p className="text-xs text-slate-400 mb-0.5">{mode === 'in' ? 'Lieferung einbuchen' : 'Artikel entnehmen'}</p>
              <p className="text-lg font-bold text-slate-800">{scannedProduct.name}</p>
              <p className="text-sm text-slate-400 mt-0.5">
                Aktuell: {scannedProduct.current_stock} {scannedProduct.unit}
                {matchedItem && <span className="ml-2 text-sky-600">· Bestellung gefunden</span>}
              </p>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Menge</label>
                <div className="flex items-center gap-3">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    className="w-24 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  {scannedProduct.last_price != null && (
                    <div className="text-sm text-slate-500">
                      <span>€ {scannedProduct.last_price.toFixed(2)} / {scannedProduct.unit}</span>
                      {(parseInt(quantity) || 0) > 0 && (
                        <span className="ml-2 font-semibold text-slate-700">
                          = € {((parseInt(quantity) || 0) * scannedProduct.last_price).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={confirmMovement}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-2.5 text-sm font-medium">
                  {mode === 'in' ? 'Einbuchen' : 'Entnehmen'}
                </button>
                <button onClick={() => { setScannedProduct(null); setMatchedItem(null) }}
                  className="px-4 border border-slate-300 rounded-xl text-sm text-slate-600">
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        )}

        {status && (
          <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm animate-slide-in-up">
            {status}
          </p>
        )}

        {/* Reorder prompt (scan_out only) */}
        {reorderPrompt && (
          <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden animate-slide-in-up">
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-amber-800">Bestand unter Meldebestand</p>
                <p className="text-xs text-amber-600 mt-0.5">{reorderPrompt.product.name}</p>
              </div>
              <button onClick={() => setReorderPrompt(null)} className="text-amber-400 hover:text-amber-600 p-0.5 shrink-0 mt-0.5">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-4">
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Nachbestellung</p>
              <div className="flex items-end gap-3">
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Menge</p>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={reorderPrompt.qty}
                    onChange={e => setReorderPrompt(p => p ? { ...p, qty: e.target.value } : p)}
                    className="w-20 border border-slate-300 rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                {reorderPrompt.product.last_price != null && (
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">
                      € {Number(reorderPrompt.product.last_price).toFixed(2)} / {reorderPrompt.product.unit}
                    </p>
                    <p className="text-sm font-bold text-slate-800">
                      € {((parseInt(reorderPrompt.qty) || 0) * Number(reorderPrompt.product.last_price)).toFixed(2)}
                    </p>
                  </div>
                )}
                <div className="shrink-0">
                  {addedToCart ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                      <Check size={16} /> Im Warenkorb
                    </div>
                  ) : (
                    <button onClick={addReorderToCart} disabled={addingToCart}
                      className="w-11 h-11 flex items-center justify-center bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl transition-colors">
                      {addingToCart ? <span className="text-sm">…</span> : <ShoppingCart size={18} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="space-y-2">
            <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm">{error}</p>
            {rawCode && (
              <button onClick={() => onAddWithBarcode(rawCode)}
                className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2">
                <Plus size={16} /> Als neuen Artikel hinzufügen
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
