import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CartItem, Order, OrderItem, Role } from '../lib/types'
import { ShoppingCart, Package, Plus, Minus, CheckCircle, ExternalLink, Check, Trash2, Undo2, ScanLine, X, Pencil, ChevronDown } from 'lucide-react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

interface Props { role: Role | null; user: User; onBadgeChange: (n: number) => void; forceOpenTab?: number; forceScanMode?: number }

// Extract domain from a URL, e.g. "https://www.dental-shop.de/..." → "dental-shop.de"
function getDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export default function OrdersPage({ role, user, onBadgeChange, forceOpenTab, forceScanMode }: Props) {
  const [tab, setTab] = useState<'cart' | 'open' | 'approval'>('cart')
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [pendingOrders, setPendingOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [placingItem, setPlacingItem] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<CartItem | null>(null)
  const [editClosing, setEditClosing] = useState(false)
  const [editForm, setEditForm] = useState<{ supplier: string; price: string; quantity: number }>({ supplier: '', price: '', quantity: 1 })
  const [editSaving, setEditSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<CartItem | null>(null)
  const [approvingOrder, setApprovingOrder] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; onUndo?: () => void } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scannedCounts, setScannedCounts] = useState<Record<string, number>>({})
  const [scanToggle, setScanToggle] = useState(false)
  const [scanConfirm, setScanConfirm] = useState<{ item: OrderItem; order: Order } | null>(null)
  const [receiving, setReceiving] = useState<string | null>(null)
  const einbuchenScannerRef = useRef<Html5Qrcode | null>(null)
  const scannerStartingRef = useRef(false)
  const scanToggleRef = useRef(false)
  const prevTabRef = useRef<'cart' | 'open' | 'approval'>('cart')
  const EINBUCHEN_SCAN_DIV = 'einbuchen-scanner-div'
  const [dragPos, setDragPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(16, Math.floor(window.innerWidth / 2) - 160) : 16,
    y: 90,
  }))
  const isDragging = useRef(false)
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 })

  useEffect(() => {
    Promise.all([fetchCart(), fetchOrders(), fetchPendingOrders()])
  }, [])

  useEffect(() => {
    if (forceOpenTab) setTab('open')
  }, [forceOpenTab])

  useEffect(() => {
    if (forceScanMode) {
      setTab('open')
      setScanToggle(true)
      scanToggleRef.current = true
    }
  }, [forceScanMode])

  // Stop scanner on unmount (user navigated to a different main page)
  useEffect(() => () => { stopInlineScanner() }, [])

  // Stop scanner only when tab changes away FROM 'open' (not on initial mount)
  useEffect(() => {
    if (prevTabRef.current === 'open' && tab !== 'open' && scanToggleRef.current) {
      stopInlineScanner()
      setScanToggle(false)
      scanToggleRef.current = false
    }
    prevTabRef.current = tab
  }, [tab])

  async function fetchCart() {
    const [{ data }, { data: prodSupData }] = await Promise.all([
      supabase
        .from('cart_items')
        .select('id, product_id, quantity, created_at, is_edited, product:products(id, name, current_stock, unit, last_price, alternative_price, alternative_url, alternative_supplier, supplier_url, preferred_supplier, brand)')
        .order('created_at'),
      supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null).limit(10000),
    ])
    setCartItems((data as unknown as CartItem[]) ?? [])
    setSuppliers(
      [...new Set((prodSupData ?? []).map((p: { preferred_supplier: string }) => p.preferred_supplier?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b))
    )
  }

  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select('id, status, supplier, total_estimate, created_at, items:order_items(id, order_id, product_id, quantity, estimated_price, product:products(id, name, barcode, preferred_supplier, supplier_url, brand))')
      .eq('status', 'ordered')
      .order('created_at', { ascending: false })
    setOrders(((data as unknown as Order[]) ?? []).filter(o => (o.items ?? []).length > 0))
    setLoading(false)
  }

  async function fetchPendingOrders() {
    const { data } = await supabase
      .from('orders')
      .select('id, status, supplier, total_estimate, created_at, items:order_items(id, order_id, product_id, quantity, estimated_price, product:products(id, name, barcode, preferred_supplier, supplier_url, brand))')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })
    setPendingOrders(((data as unknown as Order[]) ?? []).filter(o => (o.items ?? []).length > 0))
  }

  function updateBadge(cart: CartItem[], openOrders: Order[]) {
    onBadgeChange(cart.length + openOrders.length)
  }

  // Group cart items by website domain (from supplier_url), fallback to supplier name
  const cartByDomain = cartItems.reduce<Record<string, CartItem[]>>((acc, item) => {
    const domain = getDomain(item.product?.supplier_url) ?? item.product?.preferred_supplier ?? 'Kein Lieferant'
    if (!acc[domain]) acc[domain] = []
    acc[domain].push(item)
    return acc
  }, {})

  const grandTotal = cartItems.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)

  const ordersBySupplier = useMemo<[string, Order[]][]>(() => {
    const grouped: [string, Order[]][] = []
    const seen: Record<string, number> = {}
    for (const order of orders) {
      const items = order.items ?? []
      const domain = getDomain(items[0]?.product?.supplier_url) ?? order.supplier ?? 'Unbekannter Lieferant'
      if (seen[domain] === undefined) { seen[domain] = grouped.length; grouped.push([domain, []]) }
      grouped[seen[domain]][1].push(order)
    }
    return grouped
  }, [orders])

  async function updateQuantity(id: string, quantity: number) {
    if (quantity < 1) return removeItem(id)
    await supabase.from('cart_items').update({ quantity }).eq('id', id)
    const updated = cartItems.map(i => i.id === id ? { ...i, quantity } : i)
    setCartItems(updated)
    updateBadge(updated, orders)
  }

  async function removeItem(id: string) {
    await supabase.from('cart_items').delete().eq('id', id)
    const updated = cartItems.filter(i => i.id !== id)
    setCartItems(updated)
    updateBadge(updated, orders)
  }

  function showToast(message: string, onUndo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, onUndo })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  function openEditPanel(item: CartItem) {
    setEditItem(item)
    setEditClosing(false)
    setEditForm({
      supplier: item.product?.preferred_supplier ?? '',
      price: item.product?.last_price != null
        ? item.product.last_price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '',
      quantity: item.quantity,
    })
  }

  function closeEditPanel() {
    setEditClosing(true)
    setTimeout(() => { setEditItem(null); setEditClosing(false) }, 260)
  }

  async function saveEditPanel() {
    if (!editItem?.product_id) return
    setEditSaving(true)
    const n = parseFloat(editForm.price.replace(',', '.'))
    const price = isNaN(n) || n < 0 ? null : n
    const newSupplier = editForm.supplier.trim()
    const supplierChanged = newSupplier !== (editItem.product?.preferred_supplier ?? '')
    const productUpdates: Record<string, unknown> = { preferred_supplier: newSupplier || null, last_price: price }
    if (supplierChanged) {
      const { data: sup } = await supabase.from('suppliers').select('website').eq('name', newSupplier).single()
      productUpdates.supplier_url = sup?.website ?? null
    }
    await Promise.all([
      supabase.from('products').update(productUpdates).eq('id', editItem.product_id),
      supabase.from('cart_items').update({ is_edited: true, quantity: editForm.quantity }).eq('id', editItem.id),
    ])
    await fetchCart()
    setEditSaving(false)
    closeEditPanel()
    showToast('Änderungen gespeichert')
  }

  async function confirmDelete(item: CartItem) {
    setDeleteConfirm(null)
    await removeItem(item.id)
    showToast(`${item.product?.name ?? 'Artikel'} aus dem Warenkorb entfernt`, async () => {
      // Undo: re-insert the cart item
      const { data: restored } = await supabase
        .from('cart_items')
        .insert({ product_id: item.product_id, quantity: item.quantity })
        .select('*, product:products(*)')
        .single()
      if (restored) {
        const updated = [...cartItems.filter(i => i.id !== item.id), restored as unknown as CartItem]
        setCartItems(updated)
        updateBadge(updated, orders)
      } else {
        await fetchCart()
      }
      setToast(null)
    })
  }

  async function placeOrderForItem(item: CartItem) {
    setPlacingItem(item.id)
    const price = item.product?.last_price ?? null
    const supplier = item.product?.preferred_supplier || 'Kein Lieferant'
    const total = item.quantity * (price ?? 0)
    const needsApproval = total > 2000

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        created_by: user.id,
        supplier,
        status: needsApproval ? 'pending_approval' : 'ordered',
        total_estimate: total,
      })
      .select()
      .single()

    if (error || !order) { setPlacingItem(null); return }

    await supabase.from('order_items').insert({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      estimated_price: price,
    })

    await supabase.from('cart_items').delete().eq('id', item.id)

    if (needsApproval) {
      supabase.functions.invoke('send-push', {
        body: { total, supplier, needs_approval: true },
      }).catch(() => null)
      const fmtTotal = total.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      setPlacingItem(null)
      showToast(`Bestellung zur Freigabe eingereicht (€ ${fmtTotal})`)
      await Promise.all([fetchCart(), fetchOrders(), fetchPendingOrders()])
    } else {
      fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total, supplier }),
      }).catch(() => null)
      setPlacingItem(null)
      showToast(`${item.product?.name ?? 'Artikel'} als bestellt markiert`)
      await Promise.all([fetchCart(), fetchOrders()])
    }
  }

  async function approveOrder(orderId: string) {
    setApprovingOrder(orderId)
    await supabase.from('orders').update({ status: 'ordered', approved_by: user.id }).eq('id', orderId)
    setApprovingOrder(null)
    showToast('Bestellung freigegeben')
    await Promise.all([fetchOrders(), fetchPendingOrders()])
  }

  async function rejectOrder(orderId: string) {
    setApprovingOrder(orderId)
    await supabase.from('orders').update({ status: 'rejected' }).eq('id', orderId)
    setApprovingOrder(null)
    showToast('Bestellung abgelehnt')
    await fetchPendingOrders()
  }

  async function addStock(item: OrderItem, qty: number) {
    const { data: fresh } = await supabase.from('products').select('current_stock').eq('id', item.product_id).single()
    const currentStock = fresh?.current_stock ?? 0
    await supabase.from('products').update({ current_stock: currentStock + qty }).eq('id', item.product_id)
    await supabase.from('stock_movements').insert({ product_id: item.product_id, type: 'manual_in', quantity: qty, scanned_by: user.id })
  }

  async function checkOrderComplete(order: Order, counts: Record<string, number>) {
    const items = order.items ?? []
    const allDone = items.every(i => (counts[i.id] ?? 0) >= i.quantity)
    if (allDone) {
      await supabase.from('orders').update({ status: 'received', received_at: new Date().toISOString() }).eq('id', order.id)
      showToast(`Alle Artikel von ${order.supplier ?? 'Lieferant'} erhalten und eingebucht`)
      fetchOrders()
    }
  }

  // Called by scan confirm modal — increments by 1 unit
  async function scanReceiveUnit(item: OrderItem, order: Order) {
    const current = scannedCounts[item.id] ?? 0
    const next = current + 1
    const newCounts = { ...scannedCounts, [item.id]: next }
    setScannedCounts(newCounts)
    showToast(`${item.product?.name ?? 'Artikel'}: ${next}/${item.quantity} gescannt`)
    // When item fully scanned: update stock
    if (next >= item.quantity) {
      setReceiving(item.id)
      await addStock(item, item.quantity)
      setReceiving(null)
      await checkOrderComplete(order, newCounts)
    }
  }

  // Called by manual "Lieferung erhalten" button — receives full qty at once
  async function receiveOrderItem(item: OrderItem, orderId: string) {
    setReceiving(item.id)
    await addStock(item, item.quantity)
    setReceiving(null)
    const newCounts = { ...scannedCounts, [item.id]: item.quantity }
    setScannedCounts(newCounts)
    const order = orders.find(o => o.id === orderId)
    if (order) await checkOrderComplete(order, newCounts)
  }

  async function startInlineScanner() {
    if (einbuchenScannerRef.current || scannerStartingRef.current) return // already running or starting
    scannerStartingRef.current = true
    await new Promise(r => setTimeout(r, 150))
    scannerStartingRef.current = false
    if (!scanToggleRef.current) return // toggle was turned off while waiting
    try {
      const formats = [
        Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.QR_CODE,
      ]
      const s = new Html5Qrcode(EINBUCHEN_SCAN_DIV, { formatsToSupport: formats, verbose: false })
      einbuchenScannerRef.current = s
      await s.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.5 }) },
        async (raw) => {
          await s.stop()
          einbuchenScannerRef.current = null
          const clean = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
          const gtin = clean.match(/^01(\d{14})/)
          const barcode = gtin ? gtin[1] : clean
          // Find matching order item
          for (const order of orders) {
            const item = (order.items ?? []).find(i => i.product?.barcode === barcode && (scannedCounts[i.id] ?? 0) < i.quantity)
            if (item) {
              setScanConfirm({ item, order })
              return
            }
          }
          // Not found — show toast and restart scanner after short pause
          showToast('Artikel nicht in offenen Bestellungen gefunden')
          if (scanToggleRef.current) {
            await new Promise(r => setTimeout(r, 800))
            startInlineScanner()
          }
        },
        () => {}
      )
    } catch {
      // Camera error — turn off toggle
      setScanToggle(false)
      scanToggleRef.current = false
    }
  }

  function stopInlineScanner() {
    einbuchenScannerRef.current?.stop().catch(() => {})
    einbuchenScannerRef.current = null
  }

  function handleToggleScan() {
    const next = !scanToggle
    scanToggleRef.current = next
    setScanToggle(next)
    if (!next) stopInlineScanner()
  }

  // Global drag handlers
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

  // Start scanner when toggle turns on (and no confirm showing)
  useEffect(() => {
    if (scanToggle && !scanConfirm) startInlineScanner()
  }, [scanToggle])

  // Restart scanner after confirm modal is dismissed (if toggle still on)
  useEffect(() => {
    if (!scanConfirm && scanToggleRef.current) {
      startInlineScanner()
    }
  }, [scanConfirm])

  const openCount = orders.length
  const cartCount = cartItems.length
  const pendingCount = pendingOrders.length

  return (
    <div className="w-full relative">
      {/* Tab switcher */}
      <div className="flex items-center border-b border-slate-200 bg-white sticky top-0 z-10 px-4">
        <TabButton active={tab === 'cart'} onClick={() => setTab('cart')} badge={cartCount}>
          Warenkorb
        </TabButton>
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} badge={openCount}>
          Offen
        </TabButton>
        {role === 'admin' && (
          <TabButton active={tab === 'approval'} onClick={() => setTab('approval')} badge={pendingCount}>
            Zur Freigabe
          </TabButton>
        )}
        {tab === 'open' && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <ScanLine size={14} className={scanToggle ? 'text-emerald-500' : 'text-slate-400'} />
            <button
              role="switch"
              aria-checked={scanToggle}
              onClick={handleToggleScan}
              className={`relative w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                scanToggle ? 'bg-emerald-500' : 'bg-slate-200'
              }`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                scanToggle ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
        )}
      </div>

      <div>
        {/* ── Cart tab ── */}
        {tab === 'cart' && (
          cartItems.length === 0 ? (
            <div className="text-center py-16 px-4">
              <ShoppingCart size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Warenkorb ist leer</p>
              <p className="text-xs text-slate-300 mt-1">Artikel über das Lager hinzufügen</p>
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(cartByDomain).map(([domain, items], idx) => {
                    const domainTotal = items.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)
                    return (
                      <>
                        {/* Spacer between groups */}
                        {idx > 0 && (
                          <tr key={`spacer-${domain}`}><td colSpan={7} className="h-4 bg-slate-100" /></tr>
                        )}
                        {/* Domain title row */}
                        <tr key={`domain-${domain}`} className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={7} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold text-slate-800 text-base">{domain}</p>
                              <span className="text-xs text-slate-500 hidden sm:inline">
                                Gesamt: <span className="font-semibold text-slate-700">€ {domainTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </span>
                            </div>
                          </td>
                        </tr>
                        {/* Column headers */}
                        <tr key={`cols-${domain}`} className="border-b border-slate-200 bg-white">
                          <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Artikel</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Bestand</th>
                          <th className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Menge</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Einheit</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
                          <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Website</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Aktion</th>
                        </tr>
                        {/* Item rows */}
                        {items.map(item => (
                          <CartItemRow
                            key={item.id}
                            item={item}
                            placing={placingItem === item.id}
                            onUpdateQuantity={updateQuantity}
                            onPlaceOrder={placeOrderForItem}
                            onRemoveRequest={setDeleteConfirm}
                            onEdit={openEditPanel}
                          />
                        ))}
                      </>
                    )
                  })}
                </tbody>
              </table>

              {/* Grand total — only when multiple domains */}
              {Object.keys(cartByDomain).length > 1 && (
                <div className="px-4 py-3 flex items-center justify-between border-t border-slate-200">
                  <p className="text-sm font-medium text-slate-600">Gesamtsumme Warenkorb</p>
                  <p className="text-lg font-bold text-slate-800">
                    € {grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              )}
            </div>
          )
        )}

        {/* ── Approval tab (admin only) ── */}
        {tab === 'approval' && role === 'admin' && (
          pendingOrders.length === 0 ? (
            <div className="text-center py-16 px-4">
              <CheckCircle size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Keine Bestellungen zur Freigabe</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingOrders.map(order => {
                const items = order.items ?? []
                const total = order.total_estimate ?? items.reduce((s, i) => s + (i.quantity * (i.estimated_price ?? 0)), 0)
                const supplier = getDomain(items[0]?.product?.supplier_url) ?? order.supplier ?? 'Unbekannter Lieferant'
                const busy = approvingOrder === order.id
                return (
                  <div key={order.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-semibold text-slate-800 text-base">{supplier}</p>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {items.length} {items.length === 1 ? 'Artikel' : 'Artikel'} · Gesamt: <span className="font-semibold text-slate-700">€ {total.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => rejectOrder(order.id)}
                        disabled={busy}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                      >
                        {busy ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ablehnen'}
                      </button>
                      <button
                        onClick={() => approveOrder(order.id)}
                        disabled={busy}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                      >
                        {busy ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Freigeben'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ── Open orders tab ── */}
        {tab === 'open' && (
          <>
          {loading ? (
            <div className="flex justify-center py-16 px-4">
              <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Package size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Keine offenen Bestellungen</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {ordersBySupplier.map(([, groupOrders], groupIdx) => (
                  groupOrders.map((order, orderIdx) => (
                    <OpenOrderSection
                      key={order.id}
                      order={order}
                      isFirstOverall={groupIdx === 0 && orderIdx === 0}
                      isFirstInGroup={orderIdx === 0}
                      scannedCounts={scannedCounts}
                      receiving={receiving}
                      onReceiveItem={(item) => receiveOrderItem(item, order.id)}
                    />
                  ))
                ))}
              </tbody>
            </table>
          )}
          </>
        )}
      </div>

      {/* Edit cart item panel */}
      {(editItem || editClosing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closeEditPanel} />
          <div className={`fixed inset-0 bg-white z-50 flex flex-col md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[400px] md:rounded-2xl md:shadow-2xl ${editClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800 truncate flex-1 mr-2">{editItem?.product?.name}</h2>
              <button onClick={closeEditPanel} className="text-slate-400 hover:text-slate-600 p-1.5 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Lieferant</label>
                <SupplierSelect
                  value={editForm.supplier}
                  onChange={v => setEditForm(f => ({ ...f, supplier: v }))}
                  options={suppliers}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Menge</label>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, quantity: Math.max(1, f.quantity - 1) }))}
                      className="w-8 h-9 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors shrink-0">
                      <Minus size={13} />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.quantity}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n > 0) setEditForm(f => ({ ...f, quantity: n })) }}
                      onFocus={e => e.target.select()}
                      className="w-full text-center border border-slate-300 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, quantity: f.quantity + 1 }))}
                      className="w-8 h-9 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors shrink-0">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Preis pro Einheit (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editForm.price}
                    onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                    onFocus={e => e.target.select()}
                    placeholder="0,00"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Pricing summary */}
              {(() => {
                const prevTotal = (editItem?.quantity ?? 0) * (editItem?.product?.last_price ?? 0)
                const newPrice = parseFloat(editForm.price.replace(',', '.'))
                const newTotal = editForm.quantity * (isNaN(newPrice) ? 0 : newPrice)
                const diff = newTotal - prevTotal
                const fmt = (n: number) => `€ ${Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                return (
                  <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-500">
                      <span>Vorher</span>
                      <span>{fmt(prevTotal)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-slate-800">
                      <span>Neu</span>
                      <span>{fmt(newTotal)}</span>
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closeEditPanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={saveEditPanel} disabled={editSaving}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                {editSaving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 text-base mb-1">Aus Warenkorb entfernen?</h3>
            <p className="text-sm text-slate-500 mb-5">
              <span className="font-medium text-slate-700">{deleteConfirm.product?.name}</span> wird aus dem Warenkorb gelöscht.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirm)}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
              >
                Entfernen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none"><div className="pointer-events-auto flex items-center gap-3 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg max-w-[calc(100vw-2rem)]">
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              onClick={toast.onUndo}
              className="flex items-center gap-1 text-sky-300 hover:text-sky-200 transition-colors whitespace-nowrap"
            >
              <Undo2 size={13} /> Rückgängig
            </button>
          )}
        </div></div>
      )}

      {/* ── Draggable scan modal ── */}
      {scanToggle && (
        <div
          className="fixed z-50 bg-white rounded-2xl shadow-2xl overflow-hidden select-none"
          style={{ left: dragPos.x, top: dragPos.y, width: 320 }}
        >
          {/* Drag handle */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-slate-800 cursor-grab active:cursor-grabbing touch-none"
            onMouseDown={onDragStart}
            onTouchStart={onDragStart}
          >
            <div className="flex items-center gap-2">
              <ScanLine size={15} className="text-slate-400" />
              <span className="text-white text-sm font-medium">Scannen</span>
            </div>
            <button
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              onClick={handleToggleScan}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded"
            >
              <X size={16} />
            </button>
          </div>

          {/* Camera */}
          <div id={EINBUCHEN_SCAN_DIV} className="w-full bg-slate-900" style={{ minHeight: 220 }} />
          {!scanConfirm && (
            <p className="text-center text-xs text-slate-400 py-2 bg-slate-900">Barcode vor die Kamera halten</p>
          )}

          {/* Confirm panel */}
          {scanConfirm && (
            <div className="p-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-1.5">Richtiger Artikel?</p>
              <p className="font-semibold text-slate-800 text-sm leading-snug">{scanConfirm.item.product?.name ?? '—'}</p>
              <p className="text-xs text-slate-400 mt-0.5 mb-4">
                {scanConfirm.order.supplier ?? 'Lieferant'} · gescannt: {scannedCounts[scanConfirm.item.id] ?? 0}/{scanConfirm.item.quantity}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setScanConfirm(null)}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  Nicht korrekt
                </button>
                <button
                  onClick={async () => {
                    const { item, order } = scanConfirm
                    setScanConfirm(null)
                    await scanReceiveUnit(item, order)
                  }}
                  className="flex-1 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
                >
                  +1 bestätigen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Cart item row ───────────────────────────────────────────────────────────
function CartItemRow({ item, placing, onUpdateQuantity, onPlaceOrder, onRemoveRequest, onEdit }: {
  item: CartItem
  placing: boolean
  onUpdateQuantity: (id: string, qty: number) => void
  onPlaceOrder: (item: CartItem) => void
  onRemoveRequest: (item: CartItem) => void
  onEdit: (item: CartItem) => void
}) {
  const price = item.product?.last_price ?? null
  const rowTotal = item.quantity * (price ?? 0)

  return (
    <tr className="bg-white hover:bg-slate-50 transition-colors border-b border-slate-100">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800 truncate max-w-[160px] md:max-w-xs">{item.product?.name}</p>
          {item.is_edited && (
            <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Aktualisiert</span>
          )}
        </div>
        {item.product?.brand && (
          <p className="text-xs text-slate-400 mt-0.5">{item.product.brand}</p>
        )}
        {item.product?.alternative_price != null &&
         item.product?.last_price != null &&
         item.product.alternative_price < item.product.last_price && (
          <a href={item.product.alternative_url ?? undefined}
            target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-emerald-600 mt-0.5">
            <ExternalLink size={10} />
            Günstiger: € {Number(item.product.alternative_price).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bei {item.product.alternative_supplier ?? 'Alternativlieferant'}
          </a>
        )}
      </td>
      {/* Current stock */}
      <td className="px-4 py-3 text-right hidden md:table-cell">
        <span className="text-sm font-bold text-slate-800">{item.product?.current_stock ?? '—'}</span>
        {item.product?.unit && <span className="text-xs text-slate-400 ml-1">{item.product.unit}</span>}
      </td>
      {/* Order quantity */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 justify-center">
          <button onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            <Minus size={11} />
          </button>
          <span className="w-7 text-center font-semibold text-slate-800">{item.quantity}</span>
          <button onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            <Plus size={11} />
          </button>
        </div>
      </td>
      {/* Price */}
      <td className="px-3 py-3 text-right hidden sm:table-cell">
        <span className="text-sm text-slate-600">
          {price != null ? `€ ${price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
        </span>
      </td>
      {/* Row total */}
      <td className="px-3 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">
        {price != null
          ? `€ ${rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—'}
      </td>
      {/* Website link */}
      <td className="px-3 py-3 hidden sm:table-cell">
        {item.product?.supplier_url ? (
          <a href={item.product.supplier_url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 whitespace-nowrap">
            <ExternalLink size={12} />
            Website öffnen
          </a>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      {/* Actions */}
      <td className="px-3 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => onEdit(item)} title="Bearbeiten"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-sky-100 text-sky-600 hover:bg-sky-200 transition-colors">
            <Pencil size={16} />
          </button>
          <button onClick={() => onRemoveRequest(item)} title="Entfernen"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-red-100 text-red-500 hover:bg-red-200 transition-colors">
            <Trash2 size={16} />
          </button>
          <button onClick={() => onPlaceOrder(item)} disabled={placing} title="Als bestellt markieren"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors disabled:opacity-40">
            {placing
              ? <span className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin inline-block" />
              : <CheckCircle size={16} />
            }
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Tab button ─────────────────────────────────────────────────────────────
function TabButton({ active, onClick, badge, children }: {
  active: boolean; onClick: () => void; badge?: number; children: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className={`py-3 px-1 mr-6 text-sm font-medium inline-flex items-center gap-2 border-b-2 transition-colors ${
        active ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
      {!!badge && badge > 0 && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
          active ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'
        }`}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Open order section ─────────────────────────────────────────────────────
function OpenOrderSection({ order, isFirstOverall, isFirstInGroup, scannedCounts, receiving, onReceiveItem }: {
  order: Order
  isFirstOverall: boolean; isFirstInGroup: boolean
  scannedCounts: Record<string, number>; receiving: string | null
  onReceiveItem: (item: OrderItem) => void
}) {
  const items = order.items ?? []
  const domain = getDomain(items[0]?.product?.supplier_url) ?? order.supplier ?? 'Unbekannter Lieferant'
  const doneCount = items.filter(i => (scannedCounts[i.id] ?? 0) >= i.quantity).length
  const progressPct = items.length > 0 ? (doneCount / items.length) * 100 : 0

  return (
    <>
      {/* Spacer between supplier groups */}
      {!isFirstOverall && isFirstInGroup && <tr><td colSpan={7} className="h-4 bg-slate-100" /></tr>}

      {/* Supplier header — shown once per group, includes progress + total */}
      {isFirstInGroup && (
        <tr className="border-t border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800 text-base">{domain}</p>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{doneCount}/{items.length}</span>
                </div>
                {order.total_estimate != null && (
                  <span className="text-sm text-slate-600">
                    Gesamt: <span className="font-semibold text-slate-800">€ {order.total_estimate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Column headers — only once per supplier group */}
      {isFirstInGroup && (
        <tr className="border-b border-slate-200 bg-white">
          <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Artikel</th>
          <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Datum</th>
          <th className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Bestellt</th>
          <th className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gescannt</th>
          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Stück</th>
          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Aktion</th>
        </tr>
      )}

      {/* Item rows */}
      {items.map(item => {
        const scanned = scannedCounts[item.id] ?? 0
        const done = scanned >= item.quantity
        const rowTotal = item.quantity * (item.estimated_price ?? 0)
        const orderDate = new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        return (
          <tr key={item.id} className={`border-b border-slate-100 transition-colors ${done ? 'bg-emerald-50/50' : 'bg-white hover:bg-slate-50'}`}>
            <td className="px-4 py-3.5">
              <p className={`text-sm font-semibold truncate max-w-[180px] md:max-w-xs ${done ? 'text-slate-400' : 'text-slate-800'}`}>{item.product?.name ?? '—'}</p>
              {item.product?.brand && <p className="text-xs text-slate-400 mt-0.5">{item.product.brand}</p>}
            </td>
            <td className="px-3 py-3.5 text-sm text-slate-500 whitespace-nowrap hidden sm:table-cell">{orderDate}</td>
            <td className="px-3 py-3.5 text-center text-slate-500">{item.quantity}</td>
            <td className="px-3 py-3.5 text-center">
              {done ? (
                <span className="inline-flex items-center justify-center gap-1 text-slate-500 font-semibold">
                  <Check size={12} className="text-emerald-600" /> {item.quantity}
                </span>
              ) : scanned > 0 ? (
                <span className="font-semibold text-sky-600">{scanned}/{item.quantity}</span>
              ) : (
                <span className="text-slate-300">—</span>
              )}
            </td>
            <td className="px-3 py-3.5 text-right text-slate-500 whitespace-nowrap hidden sm:table-cell">
              {item.estimated_price != null
                ? `€ ${item.estimated_price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </td>
            <td className="px-3 py-3.5 text-right font-semibold text-slate-800 whitespace-nowrap">
              {item.estimated_price != null
                ? `€ ${rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </td>
            <td className="px-3 py-3.5 text-right">
              {done ? (
                <span className="flex items-center justify-end gap-1.5 text-xs text-emerald-600 font-medium">
                  <Check size={13} /> Erhalten
                </span>
              ) : (
                <button
                  onClick={() => onReceiveItem(item)}
                  disabled={receiving === item.id}
                  title="Lieferung erhalten"
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-sky-100 text-sky-600 hover:bg-sky-200 transition-colors disabled:opacity-40 ml-auto"
                >
                  {receiving === item.id
                    ? <span className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin inline-block" />
                    : <Package size={16} />
                  }
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

// ── Supplier single-select dropdown ──────────────────────────────────────────
function SupplierSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const allOptions = value && !options.includes(value) ? [value, ...options] : options
  const filtered = allOptions.filter(o => o.toLowerCase().includes(q.toLowerCase()))

  function select(v: string) {
    onChange(v)
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQ('') }}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 flex items-center justify-between gap-2 text-left"
      >
        <span className={`truncate ${value ? 'text-slate-800' : 'text-slate-400'}`}>{value || 'Lieferant wählen…'}</span>
        <ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 w-full animate-slide-in-up">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Suchen…"
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.map(o => (
              <li key={o}>
                <button type="button" onClick={() => select(o)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${o === value ? 'text-sky-600 font-medium bg-sky-50' : 'text-slate-700'}`}>
                  {o}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Keine Ergebnisse</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
