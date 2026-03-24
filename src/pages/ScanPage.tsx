import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Order, Product } from '../lib/types'
import { Plus, Check, X, PackageCheck, ScanLine, Search, ShoppingCart, ChevronLeft, ChevronRight } from 'lucide-react'

type ScanMode = 'in' | 'out'
type View = 'home' | 'scanner' | 'search'

interface Props { onAddWithBarcode: (barcode: string) => void; onSubview: (active: boolean) => void }

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

export default function ScanPage({ onAddWithBarcode, onSubview }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [view, setView] = useState<View>('home')
  const [mode, setMode] = useState<ScanMode>('out')
  const [scanning, setScanning] = useState(false)

  const [scannedProduct, setScannedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawCode, setRawCode] = useState<string | null>(null)
  const [scanNotFoundMsg, setScanNotFoundMsg] = useState<string | null>(null)

  const [reorderPrompt, setReorderPrompt] = useState<{ product: Product; qty: string } | null>(null)
  const [addingToCart, setAddingToCart] = useState(false)
  const [addedToCart, setAddedToCart] = useState(false)

  const [openOrders, setOpenOrders] = useState<Order[]>([])
  const [receivedItems, setReceivedItems] = useState<Set<string>>(new Set())
  const [matchedItem, setMatchedItem] = useState<{ orderId: string; itemId: string; expectedQty: number } | null>(null)
  const [notInOrderPrompt, setNotInOrderPrompt] = useState<{ product?: Product; barcode?: string } | null>(null)

  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [manualSearch, setManualSearch] = useState('')

  useEffect(() => {
    supabase.from('products').select('*').order('name').then(({ data }) => {
      setAllProducts(data ?? [])
    })
    return () => { stopScanner() }
  }, [])

  useEffect(() => {
    if (mode === 'in') fetchOpenOrders()
  }, [mode])


  // Product IDs that appear in any open order
  const orderProductIds = new Set(
    openOrders.flatMap(o => (o.items ?? []).map(i => i.product_id).filter(Boolean))
  )

  const filteredProducts = manualSearch.trim()
    ? allProducts.filter(p => {
        const matchesText =
          p.name.toLowerCase().includes(manualSearch.toLowerCase()) ||
          p.category.toLowerCase().includes(manualSearch.toLowerCase()) ||
          (p.article_number?.toLowerCase().includes(manualSearch.toLowerCase()) ?? false)
        if (!matchesText) return false
        if (mode === 'out') return p.current_stock > 0
        if (mode === 'in') return orderProductIds.has(p.id)
        return true
      })
    : []

  async function fetchOpenOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, items:order_items(*, product:products(*))')
      .eq('status', 'ordered')
      .order('created_at', { ascending: false })
    setOpenOrders((data as unknown as Order[]) ?? [])
  }

  function switchMode(m: ScanMode) {
    stopScanner()
    setMode(m)
    setView('home')
    onSubview(false)
    setScannedProduct(null)
    setError(null)
    setStatus(null)
    setScanNotFoundMsg(null)
  }

  function goToSearch() {
    stopScanner()
    setView('search')
    onSubview(true)
    setScannedProduct(null)
    setError(null)
  }

  function goHome() {
    stopScanner()
    setView('home')
    onSubview(false)
    setScannedProduct(null)
    setManualSearch('')
    setError(null)
    setStatus(null)
    setScanNotFoundMsg(null)
    setMatchedItem(null)
    setNotInOrderPrompt(null)
  }

  function selectProductManually(product: Product) {
    setError(null)
    setScanNotFoundMsg(null)
    setNotInOrderPrompt(null)

    if (mode === 'out') {
      if (product.current_stock <= 0) {
        setError(`${product.name} hat keinen Lagerbestand.`)
        return
      }
    }

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
      // Product exists but not in any open order
      setNotInOrderPrompt({ product })
      return
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
    const code = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
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

    const scanner = new Html5Qrcode('qr-reader', { formatsToSupport: FORMATS, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: false } })
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
      // Product not in system at all
      if (mode === 'in') {
        // In receive mode: unknown product → push to creation
        setNotInOrderPrompt({ barcode })
        setView('search')
        onSubview(true)
      } else {
        setScanNotFoundMsg(`Code „${barcode}" nicht gefunden — bitte manuell suchen`)
        setView('search')
        onSubview(true)
      }
      return
    }

    if (mode === 'out') {
      if (data.current_stock <= 0) {
        setError(`${data.name} hat keinen Lagerbestand.`)
        return
      }
      setScannedProduct(data)
      setQuantity('1')
      return
    }

    if (mode === 'in') {
      for (const order of openOrders) {
        for (const item of order.items ?? []) {
          if (item.product_id === data.id && !receivedItems.has(item.id)) {
            setMatchedItem({ orderId: order.id, itemId: item.id, expectedQty: item.quantity })
            setQuantity(String(item.quantity))
            setScannedProduct(data)
            return
          }
        }
      }
      // Product in DB but not in any open order
      setNotInOrderPrompt({ product: data, barcode })
      return
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

    setAllProducts(prev => prev.map(p => p.id === scannedProduct.id ? { ...p, current_stock: newStock } : p))

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
    <div className="w-full relative">
      {/* ── Toast ── */}
      {status && (
        <ScanToast message={status} onClose={() => setStatus(null)} />
      )}

      {/* Mode toggle */}
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10 px-4">
        {(['out', 'in'] as ScanMode[]).map(m => (
          <button key={m} onClick={() => switchMode(m)}
            className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
              mode === m ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {m === 'out' ? 'Artikel entnehmen' : 'Lieferung einbuchen'}
          </button>
        ))}
      </div>

      {/* ── HOME VIEW ── */}
      {view === 'home' && (
        <div className="p-4 space-y-4">

          {/* Two action cards */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setView('scanner'); onSubview(true) }}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col items-center gap-3 text-center active:bg-slate-50 transition-colors">
              <div className="w-14 h-14 bg-sky-50 rounded-full flex items-center justify-center">
                <ScanLine size={26} className="text-sky-500" />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">Barcode scannen</p>
                <p className="text-xs text-slate-400 mt-0.5">Kamera öffnen</p>
              </div>
            </button>
            <button onClick={goToSearch}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col items-center gap-3 text-center active:bg-slate-50 transition-colors">
              <div className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center">
                <Search size={26} className="text-slate-500" />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">Suchen</p>
                <p className="text-xs text-slate-400 mt-0.5">Manuell suchen</p>
              </div>
            </button>
          </div>

          {/* Reorder prompt */}
          {reorderPrompt && <ReorderCard reorderPrompt={reorderPrompt} addedToCart={addedToCart} addingToCart={addingToCart} onAdd={addReorderToCart} onDismiss={() => setReorderPrompt(null)} />}

          {/* Open orders for Lieferung einbuchen */}
          {mode === 'in' && (
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
                <OpenOrdersList openOrders={openOrders} receivedItems={receivedItems} onSelectItem={selectOrderItemManually} />
              </div>
            )
          )}
        </div>
      )}

      {/* ── SCANNER VIEW ── */}
      {view === 'scanner' && (
        <div>
          {/* Full-screen camera area */}
          <div
            className="relative bg-slate-900 w-full overflow-hidden"
            style={{ height: 'calc(100dvh - 100px)', minHeight: 320 }}
          >
            {/* Back button — overlaid */}
            <button
              onClick={goHome}
              className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm text-white text-sm font-medium px-3 py-2 rounded-xl"
            >
              <ChevronLeft size={16} />
              Zurück
            </button>

            {/* Camera output */}
            <div id="qr-reader" className="w-full h-full" />

            {/* Start button — full-width at bottom */}
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-end p-5">
                <button
                  onClick={startScanner}
                  className="w-full bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white py-4 rounded-2xl font-semibold text-base transition-colors"
                >
                  Kamera starten
                </button>
              </div>
            )}

            {/* Cancel — overlaid at bottom when scanning */}
            {scanning && (
              <div className="absolute bottom-5 left-5 right-5">
                <button
                  onClick={stopScanner}
                  className="w-full bg-black/40 backdrop-blur-sm text-white py-3.5 rounded-2xl text-sm font-medium"
                >
                  Abbrechen
                </button>
              </div>
            )}
          </div>

          {/* Results below camera */}
          {(scannedProduct || error || notInOrderPrompt) && (
            <div className="p-4 space-y-3">
              {scannedProduct && (
                <ProductConfirmCard
                  product={scannedProduct} quantity={quantity} mode={mode} matchedItem={matchedItem}
                  onChange={setQuantity} onConfirm={confirmMovement}
                  onCancel={() => { setScannedProduct(null); setMatchedItem(null) }}
                />
              )}
              {error && (
                <div className="space-y-2">
                  <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm">{error}</p>
                  {rawCode && mode === 'out' && (
                    <button onClick={() => onAddWithBarcode(rawCode)}
                      className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2">
                      <Plus size={16} /> Als neuen Artikel hinzufügen
                    </button>
                  )}
                </div>
              )}
              {notInOrderPrompt && (
                <NotInOrderCard
                  product={notInOrderPrompt.product}
                  barcode={notInOrderPrompt.barcode}
                  onCreateProduct={() => {
                    if (notInOrderPrompt.barcode) onAddWithBarcode(notInOrderPrompt.barcode)
                    else { setNotInOrderPrompt(null); goHome() }
                  }}
                  onDismiss={() => setNotInOrderPrompt(null)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SEARCH VIEW ── */}
      {view === 'search' && (
        <div className="p-4 space-y-3">
          <button onClick={goHome} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 p-1 -ml-1">
            <ChevronLeft size={16} />
            Zurück
          </button>

          {/* Search input — same structure as StockPage */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={manualSearch}
              onChange={e => setManualSearch(e.target.value)}
              placeholder={mode === 'in' ? 'Artikel oder Kategorie suchen…' : 'Artikel suchen…'}
              className="w-full border border-slate-300 rounded-xl pl-9 pr-9 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            />
            {manualSearch && (
              <button onClick={() => setManualSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={15} />
              </button>
            )}
          </div>

          {scanNotFoundMsg && !manualSearch && (
            <div className="space-y-2">
              <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm">
                {scanNotFoundMsg}
              </p>
              {rawCode && (
                <button onClick={() => onAddWithBarcode(rawCode)}
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2">
                  <Plus size={16} /> Als neuen Artikel hinzufügen
                </button>
              )}
            </div>
          )}

          {filteredProducts.length > 0 && !scannedProduct && (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Name</th>
                    <th className="hidden md:table-cell text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Kategorie</th>
                    <th className="hidden md:table-cell text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Artikelnr.</th>
                    <th className="hidden md:table-cell text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Lieferant</th>
                    <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Bestand</th>
                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map(p => (
                    <tr key={p.id} onClick={() => selectProductManually(p)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors">
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400 md:hidden mt-0.5">{p.category}</p>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3.5 text-sm text-slate-500">{p.category}</td>
                      <td className="hidden md:table-cell px-4 py-3.5 text-sm text-slate-500">{p.article_number ?? '—'}</td>
                      <td className="hidden md:table-cell px-4 py-3.5 text-sm text-slate-500">{p.preferred_supplier ?? '—'}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm font-bold text-slate-800">{p.current_stock}</span>
                        <span className="text-xs text-slate-400 ml-1">{p.unit}</span>
                      </td>
                      <td className="px-4 py-3.5"><ScanStockStatus product={p} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {manualSearch.trim() && filteredProducts.length === 0 && !scannedProduct && !notInOrderPrompt && (
            mode === 'in' ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-slate-500 text-sm">Kein passender Artikel in offenen Bestellungen gefunden.</p>
                <p className="text-slate-400 text-xs">Nur Artikel aus aktiven Bestellungen können eingebucht werden.</p>
              </div>
            ) : (
              <p className="text-center text-slate-400 text-sm py-4">Keine Artikel gefunden</p>
            )
          )}

          {notInOrderPrompt && !scannedProduct && (
            <NotInOrderCard
              product={notInOrderPrompt.product}
              barcode={notInOrderPrompt.barcode}
              onCreateProduct={() => {
                if (notInOrderPrompt.barcode) onAddWithBarcode(notInOrderPrompt.barcode)
                else if (notInOrderPrompt.product) {
                  // Product exists but not in order — send to stock page / orders
                  setNotInOrderPrompt(null)
                  goHome()
                }
              }}
              onDismiss={() => setNotInOrderPrompt(null)}
            />
          )}

          {mode === 'in' && !manualSearch.trim() && !scannedProduct && openOrders.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                {pendingItemCount} Artikel ausstehend
              </p>
              <OpenOrdersList openOrders={openOrders} receivedItems={receivedItems} onSelectItem={selectOrderItemManually} />
            </div>
          )}

          {scannedProduct && (
            <ProductConfirmCard
              product={scannedProduct} quantity={quantity} mode={mode} matchedItem={matchedItem}
              onChange={setQuantity} onConfirm={confirmMovement}
              onCancel={() => { setScannedProduct(null); setMatchedItem(null) }}
            />
          )}

          {reorderPrompt && <ReorderCard reorderPrompt={reorderPrompt} addedToCart={addedToCart} addingToCart={addingToCart} onAdd={addReorderToCart} onDismiss={() => setReorderPrompt(null)} />}

          {rawCode && !scannedProduct && (
            <button onClick={() => onAddWithBarcode(rawCode)}
              className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2">
              <Plus size={16} /> Als neuen Artikel hinzufügen
            </button>
          )}
        </div>
      )}

    </div>
  )
}

// ── Not-in-order prompt ────────────────────────────────────────
function NotInOrderCard({ product, barcode, onCreateProduct, onDismiss }: {
  product?: Product; barcode?: string
  onCreateProduct: () => void; onDismiss: () => void
}) {
  const isNewProduct = !product // barcode found but not in DB
  return (
    <div className="bg-white rounded-2xl border border-orange-200 overflow-hidden animate-slide-in-up">
      <div className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-orange-800">
            {isNewProduct ? 'Unbekannter Artikel' : 'Keine offene Bestellung'}
          </p>
          {product && <p className="text-xs text-orange-600 mt-0.5">{product.name}</p>}
          {barcode && !product && <p className="text-xs text-orange-600 mt-0.5 font-mono">{barcode}</p>}
        </div>
        <button onClick={onDismiss} className="text-orange-400 hover:text-orange-600 p-0.5 shrink-0 mt-0.5">
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm text-slate-600">
          {isNewProduct
            ? 'Dieser Barcode ist noch nicht im System. Lege den Artikel zuerst im Lager an, bestelle ihn und buche die Lieferung dann hier ein.'
            : 'Dieser Artikel hat keine offene Bestellung. Nur Artikel aus aktiven Bestellungen können über „Lieferung einbuchen" eingebucht werden.'
          }
        </p>
        {isNewProduct && (
          <button
            onClick={onCreateProduct}
            className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
          >
            <Plus size={15} /> Neuen Artikel anlegen
          </button>
        )}
        {!isNewProduct && (
          <p className="text-xs text-slate-400">
            Gehe zu Bestellungen, um diesen Artikel zu bestellen und dann die Lieferung einzubuchen.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Stock status badge ─────────────────────────────────────────
function ScanStockStatus({ product: p }: { product: Product }) {
  if (p.current_stock <= 0)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500"><span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />Kein Bestand</span>
  if (p.current_stock <= p.min_stock)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-500"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />Niedriger Bestand</span>
  if (p.current_stock <= p.min_stock * 1.5)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />Knapp</span>
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />Verfügbar</span>
}

// ── Sub-components ────────────────────────────────────────────

// Stock level helper for confirm card
function scanStockLevel(p: Product): { color: string; bg: string; border: string; label: string } {
  if (p.current_stock <= 0)          return { color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200',     label: 'Kein Bestand' }
  if (p.current_stock <= p.min_stock) return { color: 'text-red-500',     bg: 'bg-red-50',     border: 'border-red-200',     label: 'Kritisch' }
  if (p.current_stock <= p.min_stock * 1.5) return { color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-200',  label: 'Niedrig' }
  return                                     { color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Verfügbar' }
}

function ProductConfirmCard({ product, quantity, mode, matchedItem, onChange, onConfirm, onCancel }: {
  product: Product; quantity: string; mode: ScanMode
  matchedItem: { orderId: string; itemId: string; expectedQty: number } | null
  onChange: (v: string) => void; onConfirm: () => void; onCancel: () => void
}) {
  const stock = scanStockLevel(product)
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-in-up">
      <div className="px-4 py-4 border-b border-slate-100">
        <p className="text-lg font-bold text-slate-800 mb-2">{product.name}</p>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold ${stock.color}`}>
            {product.current_stock}
            <span className="text-sm font-normal text-slate-400 ml-1">{product.unit}</span>
          </span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stock.bg} ${stock.color} border ${stock.border}`}>
            {stock.label}
          </span>
          {matchedItem && (
            <span className="text-xs bg-sky-50 text-sky-600 border border-sky-200 px-2.5 py-1 rounded-full font-medium">
              Bestellung gefunden
            </span>
          )}
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Menge</label>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" value={quantity}
            onChange={e => onChange(e.target.value)}
            className="w-28 border border-slate-300 rounded-lg px-3 py-2.5 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onConfirm}
            className="flex-1 bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-3 text-sm font-semibold">
            {mode === 'in' ? 'Einbuchen' : 'Entnehmen'}
          </button>
          <button onClick={onCancel}
            className="px-4 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toast (slides from top) ────────────────────────────────────
function ScanToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [message, onClose])

  return (
    <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-4 flex items-start gap-3 animate-slide-in-down">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <Check size={16} className="text-emerald-400" />
        </div>
        <p className="flex-1 text-sm font-medium leading-snug">{message}</p>
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function ReorderCard({ reorderPrompt, addedToCart, addingToCart, onAdd, onDismiss }: {
  reorderPrompt: { product: Product; qty: string }
  addedToCart: boolean; addingToCart: boolean
  onAdd: () => void; onDismiss: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden animate-slide-in-up">
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-amber-800">Bestand unter Meldebestand</p>
          <p className="text-xs text-amber-600 mt-0.5">{reorderPrompt.product.name}</p>
        </div>
        <button onClick={onDismiss} className="text-amber-400 hover:text-amber-600 p-0.5 shrink-0 mt-0.5">
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-4">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Nachbestellung</p>
        <div className="flex items-end gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Menge</p>
            <div className="w-20 border border-slate-300 rounded-xl px-3 py-2.5 font-semibold text-slate-800">
              {reorderPrompt.qty}
            </div>
          </div>
          {reorderPrompt.product.last_price != null && (
            <div className="flex-1">
              <p className="text-xs text-slate-500 mb-1">
                € {Number(reorderPrompt.product.last_price).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {reorderPrompt.product.unit}
              </p>
              <p className="text-sm font-bold text-slate-800">
                € {((parseInt(reorderPrompt.qty) || 0) * Number(reorderPrompt.product.last_price)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          )}
          <div className="shrink-0">
            {addedToCart ? (
              <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                <Check size={16} /> Im Warenkorb
              </div>
            ) : (
              <button onClick={onAdd} disabled={addingToCart}
                className="w-11 h-11 flex items-center justify-center bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl transition-colors">
                {addingToCart ? <span className="text-sm">…</span> : <ShoppingCart size={18} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function OpenOrdersList({ openOrders, receivedItems, onSelectItem }: {
  openOrders: Order[]
  receivedItems: Set<string>
  onSelectItem: (orderId: string, itemId: string, product: Product, qty: number) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Detect dates with multiple orders so we can add time for disambiguation
  const dateCounts = openOrders.reduce<Record<string, number>>((acc, o) => {
    const day = o.created_at.slice(0, 10)
    acc[day] = (acc[day] ?? 0) + 1
    return acc
  }, {})

  function formatOrderDate(isoString: string) {
    const date = new Date(isoString)
    const day = isoString.slice(0, 10)
    const base = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    if ((dateCounts[day] ?? 0) > 1) {
      return `${base}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    }
    return base
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 w-4"></th>
              <th className="text-left px-3 py-3 text-xs font-medium text-slate-400">Lieferant</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-slate-400 hidden sm:table-cell">Datum</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-slate-400">Artikel</th>
              <th className="text-right px-3 py-3 text-xs font-medium text-slate-400 hidden sm:table-cell">Gesamt</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-slate-400">Fortschritt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {openOrders.map(order => {
              const items = order.items ?? []
              const doneCount = items.filter(i => receivedItems.has(i.id)).length
              const allDone = doneCount === items.length && items.length > 0
              const isExpanded = expandedId === order.id

              return (
                <>
                  <tr
                    key={order.id}
                    onClick={() => setExpandedId(isExpanded ? null : order.id)}
                    className={`cursor-pointer transition-colors ${allDone ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-3">
                      <ChevronRight size={14} className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {order.supplier ?? 'Unbekannt'}
                      <p className="text-xs text-slate-400 sm:hidden mt-0.5">{formatOrderDate(order.created_at)}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-500 whitespace-nowrap hidden sm:table-cell">
                      {formatOrderDate(order.created_at)}
                    </td>
                    <td className="px-3 py-3 text-center text-slate-600">
                      {items.length}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-700 whitespace-nowrap hidden sm:table-cell">
                      {order.total_estimate != null
                        ? `€ ${order.total_estimate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—'
                      }
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-center gap-1">
                        {allDone ? (
                          <Check size={16} className="text-emerald-500" />
                        ) : (
                          <>
                            <span className="text-xs font-medium text-slate-600">{doneCount}/{items.length}</span>
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-sky-500 rounded-full transition-all"
                                style={{ width: items.length > 0 ? `${(doneCount / items.length) * 100}%` : '0%' }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded items */}
                  {isExpanded && (
                    <tr key={`${order.id}-items`} className={allDone ? 'bg-emerald-50/20' : 'bg-slate-50/60'}>
                      <td colSpan={6} className="px-4 pb-3 pt-1">
                        <div className="ml-4 divide-y divide-slate-100">
                          {items.map(item => {
                            const done = receivedItems.has(item.id)
                            return (
                              <button
                                key={item.id}
                                disabled={done}
                                onClick={e => {
                                  e.stopPropagation()
                                  item.product && onSelectItem(order.id, item.id, item.product, item.quantity)
                                }}
                                className={`w-full flex items-center gap-3 py-2 text-left transition-colors ${
                                  done ? 'opacity-40 cursor-default' : 'hover:bg-white/80 rounded-lg px-2 -mx-2'
                                }`}
                              >
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                  done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'
                                }`}>
                                  {done && <Check size={11} className="text-white" />}
                                </div>
                                <span className={`text-sm flex-1 ${done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                  {item.product?.name ?? '—'}
                                </span>
                                <span className="text-xs text-slate-400 shrink-0">{item.quantity}×</span>
                                {item.estimated_price != null && (
                                  <span className="text-xs text-slate-400 shrink-0 hidden sm:inline">
                                    € {(item.quantity * item.estimated_price).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
