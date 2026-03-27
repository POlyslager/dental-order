import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CartItem, Order, OrderItem, PriceAlternative, Role } from '../lib/types'
import { ShoppingCart, Package, Plus, Minus, CheckCircle, ExternalLink, Check, Trash2, Undo2, ScanLine, X, Pencil, Clock, XCircle, TrendingDown, Flashlight, FlashlightOff } from 'lucide-react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

interface Props { role: Role | null; user: User; onBadgeChange: (n: number) => void; forceOpenTab?: number; forceScanMode?: number }

const HS_SUPPLIER = 'Henry Schein Dental'

function hsEffectivePrice(product: { last_price: number | null; preferred_supplier: string | null; brand: string | null } | undefined): number | null {
  if (!product?.last_price) return null
  if (product.preferred_supplier !== HS_SUPPLIER) return product.last_price
  const discount = product.brand === 'Henry Schein' ? 0.29 : 0.28
  return product.last_price * (1 - discount)
}

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
  const [pendingLoaded, setPendingLoaded] = useState(false)
  const [rejectedOrders, setRejectedOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [placingItem, setPlacingItem] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<CartItem | null>(null)
  const [editClosing, setEditClosing] = useState(false)
  const [editForm, setEditForm] = useState<{ price: string; quantity: number }>({ price: '', quantity: 1 })
  const [editSaving, setEditSaving] = useState(false)
const [domainToSupplier, setDomainToSupplier] = useState<Record<string, string>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<CartItem | null>(null)
  const [approvingOrder, setApprovingOrder] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; onUndo?: () => void; variant?: 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scannedCounts, setScannedCounts] = useState<Record<string, number>>({})
  const [scanToggle, setScanToggle] = useState(false)
  const [receiving, setReceiving] = useState<string | null>(null)
  const rejectedOrdersRef = useRef<Order[]>([])
  const einbuchenScannerRef = useRef<Html5Qrcode | null>(null)
  const priceHitAbortRef = useRef<AbortController | null>(null)
  const scannedCountsRef = useRef<Record<string, number>>({})
  const ordersRef = useRef<Order[]>([])
  const scannerStartingRef = useRef(false)
  const [einbuchenTorchOn, setEinbuchenTorchOn] = useState(false)
  const [einbuchenTorchSupported, setEinbuchenTorchSupported] = useState(false)
  const [einbuchenManual, setEinbuchenManual] = useState('')
  const [scanFlashError, setScanFlashError] = useState(false)
  const scanToggleRef = useRef(false)
  const prevTabRef = useRef<'cart' | 'open' | 'approval'>('cart')
  const forceOpenTabInitRef = useRef(forceOpenTab)
  const forceScanModeInitRef = useRef(forceScanMode)
  const EINBUCHEN_SCAN_DIV = 'einbuchen-scanner-div'
  const [dragPos, setDragPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(16, Math.floor(window.innerWidth / 2) - 160) : 16,
    y: 90,
  }))
  const isDragging = useRef(false)
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 })
  const [priceHits, setPriceHits] = useState<Record<string, PriceAlternative[]>>({})
  const [priceModal, setPriceModal] = useState<CartItem | null>(null)

  useEffect(() => {
    Promise.all([fetchCart(), fetchOrders(), fetchPendingOrders(), fetchRejectedOrders()])
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        fetchPendingOrders()
        fetchRejectedOrders()
        fetchOrders()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    if (forceOpenTab === forceOpenTabInitRef.current) return
    setTab('open')
  }, [forceOpenTab])

  useEffect(() => {
    if (forceScanMode === forceScanModeInitRef.current) return
    setTab('open')
    setScanToggle(true)
    scanToggleRef.current = true
  }, [forceScanMode])

  // Keep refs in sync with state so scanner callbacks always see fresh values
  useEffect(() => { scannedCountsRef.current = scannedCounts }, [scannedCounts])
  useEffect(() => { ordersRef.current = orders }, [orders])

  // Stop scanner on unmount + cancel any unread rejected orders + abort price lookups
  useEffect(() => () => {
    stopInlineScanner()
    priceHitAbortRef.current?.abort()
    const ids = rejectedOrdersRef.current.map(o => o.id)
    if (ids.length > 0) void supabase.from('orders').update({ status: 'cancelled' }).in('id', ids)
  }, [])

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
    const [{ data }, , { data: supRows }] = await Promise.all([
      supabase
        .from('cart_items')
        .select('id, product_id, quantity, created_at, is_edited, product:products(id, name, current_stock, unit, last_price, alternative_price, alternative_url, alternative_supplier, supplier_url, preferred_supplier, brand)')
        .order('created_at'),
      supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null).limit(10000),
      supabase.from('suppliers').select('name, website').not('website', 'is', null),
    ])
    const loadedItems = (data as unknown as CartItem[]) ?? []
    setCartItems(loadedItems)
    if (loadedItems.length > 0) fetchPriceHits(loadedItems)
const map: Record<string, string> = {}
    for (const r of (supRows ?? []) as { name: string; website: string }[]) {
      const domain = getDomain(r.website)
      if (domain) map[domain] = r.name
    }
    setDomainToSupplier(map)
  }

  function fetchPriceHits(items: CartItem[]) {
    if (items.length === 0) return
    priceHitAbortRef.current?.abort()
    const controller = new AbortController()
    priceHitAbortRef.current = controller
    Promise.all(items.map(async item => {
      try {
        const res = await fetch('/api/find-alternatives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productName: item.product?.name, brand: item.product?.brand }),
          signal: controller.signal,
        })
        const data = await res.json()
        const currentPrice = hsEffectivePrice(item.product) ?? 0
        const alternatives = (data.results ?? []).filter((a: PriceAlternative) =>
          currentPrice <= 0 || (currentPrice - a.price) / currentPrice <= 0.90
        ) as PriceAlternative[]
        setPriceHits(prev => ({ ...prev, [item.product_id]: alternatives }))
      } catch (e) { if ((e as Error).name !== 'AbortError') { /* ignore other errors */ } }
    }))
  }

  async function applyAlternative(item: CartItem, alt: PriceAlternative) {
    await supabase.from('products').update({
      preferred_supplier: alt.domain,
      supplier_url: alt.url,
      last_price: alt.price,
    }).eq('id', item.product_id)
    await supabase.from('cart_items').update({ is_edited: true }).eq('id', item.id)
    setPriceModal(null)
    fetchCart()
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
    setPendingLoaded(true)
  }

  async function fetchRejectedOrders() {
    const { data } = await supabase
      .from('orders')
      .select('id, notes')
      .eq('status', 'rejected')
      .order('created_at', { ascending: false })
    const orders = (data as unknown as Order[]) ?? []
    rejectedOrdersRef.current = orders
    setRejectedOrders(orders)
  }

  function updateBadge(cart: CartItem[]) {
    onBadgeChange(cart.length + ordersBySupplier.length)
  }

  useEffect(() => {
    if (rejectedOrders.length === 0) return
    const reason = rejectedOrders[0].notes?.trim()
    setToast({ message: `Bestellung abgelehnt${reason ? ` – ${reason}` : ''}`, variant: 'error' })
  }, [rejectedOrders])

  function resolveSupplier(preferredSupplier: string | null | undefined, supplierUrl: string | null | undefined, fallback = 'Kein Lieferant'): string {
    if (preferredSupplier) return preferredSupplier
    const domain = getDomain(supplierUrl)
    if (domain) return domainToSupplier[domain] ?? domain
    return fallback
  }

  // Group cart items by supplier name, fallback to domain from supplier_url
  const cartByDomain = cartItems.reduce<Record<string, CartItem[]>>((acc, item) => {
    const domain = resolveSupplier(item.product?.preferred_supplier, item.product?.supplier_url)
    if (!acc[domain]) acc[domain] = []
    acc[domain].push(item)
    return acc
  }, {})

  const grandTotal = cartItems.reduce((s, i) => s + (i.quantity * (hsEffectivePrice(i.product) ?? 0)), 0)

  const hsTotal = cartItems
    .filter(i => i.product?.preferred_supplier === HS_SUPPLIER)
    .reduce((s, i) => s + (i.quantity * (hsEffectivePrice(i.product) ?? 0)), 0)
  const hsVolumeBonus = hsTotal > 1000 ? (hsTotal - 1000) * 0.01 : 0

  const ordersBySupplier = useMemo<[string, Order[]][]>(() => {
    const grouped: [string, Order[]][] = []
    const seen: Record<string, number> = {}
    for (const order of orders) {
      const items = order.items ?? []
      const domain = resolveSupplier(order.supplier ?? items[0]?.product?.preferred_supplier, items[0]?.product?.supplier_url, 'Unbekannter Lieferant')
      if (seen[domain] === undefined) { seen[domain] = grouped.length; grouped.push([domain, []]) }
      grouped[seen[domain]][1].push(order)
    }
    return grouped
  }, [orders])

  useEffect(() => {
    if (loading) return
    onBadgeChange(cartItems.length + ordersBySupplier.length)
  }, [cartItems, ordersBySupplier, loading])

  async function cancelPendingOnCartChange(newCartItems: CartItem[]) {
    // Clear rejection toast and state when cart is modified
    setToast(prev => prev?.variant === 'error' ? null : prev)
    const rejectedIds = rejectedOrdersRef.current.map(o => o.id)
    rejectedOrdersRef.current = []
    setRejectedOrders([])
    if (rejectedIds.length > 0) {
      try { await supabase.from('orders').update({ status: 'cancelled' }).in('id', rejectedIds) } catch { /* ignore */ }
    }
    if (pendingOrders.length === 0) return
    await supabase.from('orders').update({ status: 'cancelled' }).in('id', pendingOrders.map(o => o.id))
    setPendingOrders([])
    const newTotal = newCartItems.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)
    if (newTotal < 2000) showToast('Freigabe nicht mehr erforderlich – Bestellung zurückgezogen')
  }

  async function updateQuantity(id: string, quantity: number) {
    if (quantity < 0) return
    await supabase.from('cart_items').update({ quantity }).eq('id', id)
    const updated = cartItems.map(i => i.id === id ? { ...i, quantity } : i)
    setCartItems(updated)
    updateBadge(updated)
    await cancelPendingOnCartChange(updated)
  }

  async function removeItem(id: string) {
    await supabase.from('cart_items').delete().eq('id', id)
    const updated = cartItems.filter(i => i.id !== id)
    setCartItems(updated)
    updateBadge(updated)
    await cancelPendingOnCartChange(updated)
  }

  function showToast(message: string, onUndo?: () => void, variant?: 'error') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, onUndo, variant })
    if (!variant) toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  function openEditPanel(item: CartItem) {
    setEditItem(item)
    setEditClosing(false)
    setEditForm({
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
    await Promise.all([
      supabase.from('products').update({ last_price: price }).eq('id', editItem.product_id),
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
        updateBadge(updated)
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
      fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total, supplier, needs_approval: true }),
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

  const [submittingApproval, setSubmittingApproval] = useState(false)

  async function submitCartForApproval() {
    setSubmittingApproval(true)
    const { data: order, error } = await supabase
      .from('orders')
      .insert({ created_by: user.id, supplier: 'Warenkorb', status: 'pending_approval', total_estimate: grandTotal })
      .select()
      .single()
    if (error || !order) { setSubmittingApproval(false); return }
    await supabase.from('order_items').insert(
      cartItems.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        estimated_price: item.product?.last_price ?? null,
      }))
    )
    // Keep cart items visible — they display as locked in the cart until approved/rejected
    fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total: grandTotal, supplier: 'Warenkorb', needs_approval: true }),
    }).catch(() => null)
    setSubmittingApproval(false)
    const fmt = grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    showToast(`Warenkorb zur Freigabe eingereicht (€ ${fmt})`)
    await fetchPendingOrders()
  }

  async function approveOrder(orderId: string) {
    setApprovingOrder(orderId)
    const order = pendingOrders.find(o => o.id === orderId)
    await supabase.from('orders').update({ status: 'ordered', approved_by: user.id }).eq('id', orderId)
    // Clear the cart items that were part of this order
    if (order?.items?.length) {
      const productIds = order.items.map(i => i.product_id)
      await supabase.from('cart_items').delete().in('product_id', productIds)
    }
    setPendingOrders(prev => prev.filter(o => o.id !== orderId))
    setApprovingOrder(null)
    showToast('Bestellung freigegeben')
    await Promise.all([fetchCart(), fetchOrders(), fetchPendingOrders()])
  }

  const [rejectModal, setRejectModal] = useState<{ orderId: string; orderItems: OrderItem[]; supplier: string } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  function openRejectModal(order: Order) {
    setRejectModal({ orderId: order.id, orderItems: order.items ?? [], supplier: order.supplier ?? 'Lieferant' })
    setRejectReason('')
  }

  async function confirmReject() {
    if (!rejectModal) return
    setRejecting(true)
    const { orderId } = rejectModal
    await supabase.from('orders')
      .update({ status: 'rejected', ...(rejectReason.trim() ? { notes: rejectReason.trim() } : {}) })
      .eq('id', orderId)
    // Cart items were never removed — they remain in the cart automatically
    setPendingOrders(prev => prev.filter(o => o.id !== orderId))
    setRejecting(false)
    setRejectModal(null)
    await Promise.all([fetchCart(), fetchPendingOrders(), fetchRejectedOrders()])
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
      // Only show "Alle Artikel" toast if no other orders from the same supplier remain
      const supplierKey = resolveSupplier(order.supplier ?? items[0]?.product?.preferred_supplier, items[0]?.product?.supplier_url, 'Unbekannter Lieferant')
      const remainingFromSupplier = ordersRef.current.filter(o => {
        if (o.id === order.id) return false
        const oItems = o.items ?? []
        const key = resolveSupplier(o.supplier ?? oItems[0]?.product?.preferred_supplier, oItems[0]?.product?.supplier_url, 'Unbekannter Lieferant')
        return key === supplierKey
      })
      if (remainingFromSupplier.length === 0) {
        showToast(`Alle Artikel von ${order.supplier ?? 'Lieferant'} erhalten und eingebucht`)
      }
      fetchOrders()
    }
  }

  // Called on each scan — increments by 1 unit
  async function scanReceiveUnit(item: OrderItem, order: Order, lot?: string) {
    const current = scannedCountsRef.current[item.id] ?? 0
    const next = current + 1
    const newCounts = { ...scannedCountsRef.current, [item.id]: next }
    scannedCountsRef.current = newCounts
    setScannedCounts(newCounts)
    showToast(`${item.product?.name ?? 'Artikel'}: ${next}/${item.quantity} gescannt`)
    if (lot && item.product_id) {
      await supabase.from('products').update({ lot_number: lot }).eq('id', item.product_id)
    }
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
    showToast(`${item.product?.name ?? 'Artikel'} eingebucht`)
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
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ]
      const s = new Html5Qrcode(EINBUCHEN_SCAN_DIV, { formatsToSupport: formats, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } })
      einbuchenScannerRef.current = s
      await s.start(
        { facingMode: 'environment' },
        { fps: 25, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.8, height: Math.min(w, h) * 0.5 }) },
        async (raw) => {
          await s.stop()
          s.clear()
          einbuchenScannerRef.current = null
          const found = await processEinbuchenBarcode(raw)
          if (!found) {
            showToast('Artikel nicht in offenen Bestellungen gefunden')
            setScanFlashError(true)
          }
          if (scanToggleRef.current) {
            await new Promise(r => setTimeout(r, found ? 500 : 800))
            setScanFlashError(false)
            startInlineScanner()
          }
        },
        () => {}
      )
      // Detect torch support after scanner is running
      try {
        const caps = s.getRunningTrackCameraCapabilities()
        if (caps.torchFeature().isSupported()) setEinbuchenTorchSupported(true)
      } catch { /* torch not available */ }
    } catch {
      // Camera error — turn off toggle
      setScanToggle(false)
      scanToggleRef.current = false
    }
  }

  async function processEinbuchenBarcode(raw: string): Promise<boolean> {
    const clean = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
    const gtin = clean.match(/^01(\d{14})/)
    const raw14 = gtin ? gtin[1] : clean
    const barcode = raw14.length === 14 && raw14.startsWith('0') ? raw14.slice(1) : raw14
    const lotMatch = clean.match(/10([^\x1d]{1,20})/)
    const lot = lotMatch?.[1]
    for (const order of ordersRef.current) {
      const item = (order.items ?? []).find(i => i.product?.barcode === barcode && (scannedCountsRef.current[i.id] ?? 0) < i.quantity)
      if (item) { await scanReceiveUnit(item, order, lot); return true }
    }
    return false
  }

  async function toggleEinbuchenTorch() {
    if (!einbuchenScannerRef.current) return
    try {
      const caps = einbuchenScannerRef.current.getRunningTrackCameraCapabilities()
      await caps.torchFeature().apply(!einbuchenTorchOn)
      setEinbuchenTorchOn(v => !v)
    } catch { /* ignore */ }
  }

  function stopInlineScanner() {
    const s = einbuchenScannerRef.current
    einbuchenScannerRef.current = null
    setEinbuchenTorchSupported(false)
    setEinbuchenTorchOn(false)
    if (s?.isScanning) s.stop().then(() => s.clear()).catch(() => {})
    else s?.clear()
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

  // Start scanner when toggle turns on
  useEffect(() => {
    if (scanToggle) startInlineScanner()
  }, [scanToggle])

  const openCount = ordersBySupplier.length
  const cartCount = cartItems.length
  const pendingCount = pendingLoaded ? pendingOrders.reduce((s, o) => s + (o.items ?? []).length, 0) : null

  function PriceCompareModal({ item, alternatives, onClose, onApply }: {
    item: CartItem
    alternatives: PriceAlternative[]
    onClose: () => void
    onApply: (item: CartItem, alt: PriceAlternative) => void
  }) {
    const currentPrice = item.product?.last_price ?? null
    const sorted = [...alternatives].sort((a, b) => a.price - b.price)

    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 truncate flex-1 mr-2">{item.product?.name}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="p-5 space-y-2">
            {/* Current supplier row */}
            <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.product?.preferred_supplier ?? getDomain(item.product?.supplier_url) ?? '—'}</p>
                <span className="text-xs text-slate-400 dark:text-slate-500">Aktuell</span>
              </div>
              <div className="w-20 text-right shrink-0">
                {currentPrice != null && (
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    € {currentPrice.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              {item.product?.supplier_url ? (
                <a href={item.product.supplier_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 px-3 py-2 rounded-lg transition-colors shrink-0 whitespace-nowrap">
                  <ExternalLink size={12} />
                  Öffnen
                </a>
              ) : <div className="w-[72px]" />}
              <div className="w-[100px]" />
            </div>
            {/* Alternative rows */}
            {sorted.map(alt => {
              const savings = currentPrice != null && currentPrice > 0
                ? ((currentPrice - alt.price) / currentPrice) * 100
                : null
              const isCheaper = savings != null && savings > 0.5
              const euroSavings = currentPrice != null ? currentPrice - alt.price : null
              return (
                <div key={alt.url} className="flex items-center gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{alt.domain}</p>
                    {alt.name && <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{alt.name}</p>}
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      € {alt.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {savings != null && euroSavings != null && (
                      <span className={`text-xs font-medium ${isCheaper ? 'text-emerald-600' : 'text-slate-400 dark:text-slate-500'}`}>
                        {isCheaper
                          ? `−€ ${Math.abs(euroSavings).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${Math.round(savings)}%)`
                          : savings < -0.5 ? `+${Math.round(-savings)}%` : '≈ gleich'}
                      </span>
                    )}
                  </div>
                  <a href={alt.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 px-3 py-2 rounded-lg transition-colors shrink-0 whitespace-nowrap">
                    <ExternalLink size={12} />
                    Öffnen
                  </a>
                  <button
                    onClick={() => onApply(item, alt)}
                    className={`w-[100px] text-xs font-medium px-2.5 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${isCheaper
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                  >
                    Als Standard
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full relative flex flex-col h-full">
      {/* Tab switcher */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 sticky top-0 z-10 px-4">
        <TabButton active={tab === 'cart'} onClick={() => setTab('cart')} badge={cartCount}>
          Warenkorb
        </TabButton>
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} badge={openCount}>
          Offen
        </TabButton>
        {role === 'admin' && (
          <span className="self-stretch flex items-center">
            <span className="w-px h-5 bg-slate-200 mr-6" />
            <TabButton active={tab === 'approval'} onClick={() => setTab('approval')} badge={pendingCount}>
              Zur Freigabe
            </TabButton>
          </span>
        )}
        {tab === 'open' && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <ScanLine size={14} className={scanToggle ? 'text-emerald-500' : 'text-slate-400'} />
            <button
              role="switch"
              aria-checked={scanToggle}
              onClick={handleToggleScan}
              className={`relative w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                scanToggle ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                scanToggle ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* ── Cart tab ── */}
        {tab === 'cart' && (
          cartItems.length === 0 && pendingOrders.length === 0 ? (
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
                    const domainTotal = items.reduce((s, i) => s + (i.quantity * (hsEffectivePrice(i.product) ?? 0)), 0)
                    return (
                      <React.Fragment key={domain}>
                        {/* Spacer between groups */}
                        {idx > 0 && (
                          <tr><td colSpan={7} className="h-4 bg-slate-100 dark:bg-slate-700" /></tr>
                        )}
                        {/* Domain title row */}
                        <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                          <td colSpan={7} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold text-slate-800 dark:text-slate-100 text-base">{domain}</p>
                              <div className="flex flex-col items-end gap-0.5 hidden sm:flex">
                                {domain === HS_SUPPLIER && hsVolumeBonus === 0 && hsTotal > 0 && (
                                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                                    Noch {(1000 - hsTotal).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € bis Volumenbonus
                                  </span>
                                )}
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  Gesamt: <span className={`font-semibold ${domain === HS_SUPPLIER && hsVolumeBonus > 0 ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>€ {domainTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </span>
                                {domain === HS_SUPPLIER && hsVolumeBonus > 0 && (
                                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                    <TrendingDown size={11} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    Volumenbonus: <span className="font-semibold text-emerald-600 dark:text-emerald-400">−€ {hsVolumeBonus.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    {' · '}
                                    <span className="font-semibold text-slate-700 dark:text-slate-200">€ {(domainTotal - hsVolumeBonus).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {/* Column headers */}
                        <tr className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                          <th className="text-left text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-4 py-3">Artikel</th>
                          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Bestand</th>
                          <th className="text-center text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Menge</th>
                          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Einheit</th>
                          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
                          <th className="text-left text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Website</th>
                          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Aktion</th>
                        </tr>
                        {/* Item rows */}
                        {items.map(item => (
                          <CartItemRow
                            key={item.id}
                            item={item}
                            placing={placingItem === item.id}
                            requiresApproval={grandTotal > 2000}
                            onUpdateQuantity={updateQuantity}
                            onPlaceOrder={placeOrderForItem}
                            onRemoveRequest={setDeleteConfirm}
                            onEdit={openEditPanel}
                            alternatives={priceHits[item.product_id]}
                            onShowAlternatives={item => setPriceModal(item)}
                          />
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>

              {/* Pending approval orders — shown as locked section in cart */}
              {pendingOrders.map(order => {
                const orderTotal = order.total_estimate ?? (order.items ?? []).reduce((s, i) => s + i.quantity * (i.estimated_price ?? 0), 0)
                return (
                  <div key={order.id} className="border-t-2 border-amber-200">
                    <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-amber-500 shrink-0" />
                        <span className="text-sm font-semibold text-amber-700">Wartet auf Freigabe</span>
                        <span className="text-xs text-amber-500">· {(order.items ?? []).length} Artikel</span>
                      </div>
                      <span className="text-sm font-semibold text-amber-700">
                        € {orderTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {(order.items ?? []).map(item => (
                          <tr key={item.id} className="border-b border-amber-50 dark:border-amber-800/40 bg-white dark:bg-slate-900 opacity-60">
                            <td className="px-4 py-3">
                              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{item.product?.name ?? '—'}</p>
                            </td>
                            <td className="text-center px-3 py-3 text-slate-400 dark:text-slate-500 whitespace-nowrap">{item.quantity}×</td>
                            <td className="text-right px-3 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {item.estimated_price != null ? `€ ${(item.estimated_price * item.quantity).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
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
            <div>
              {pendingOrders.map(order => {
                const items = order.items ?? []
                const byDomain = items.reduce<Record<string, OrderItem[]>>((acc, item) => {
                  const domain = resolveSupplier(item.product?.preferred_supplier, item.product?.supplier_url)
                  if (!acc[domain]) acc[domain] = []
                  acc[domain].push(item)
                  return acc
                }, {})

                return (
                  <div key={order.id} className="border-b-4 border-slate-100 dark:border-slate-800">
                    {/* Submission date header */}
                    <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800/40 flex items-center gap-2">
                      <Clock size={13} className="text-amber-500 shrink-0" />
                      <span className="text-xs text-amber-700 font-medium">
                        Eingereicht am {new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(byDomain).map(([domain, domainItems], idx) => {
                          const domainTotal = domainItems.reduce((s, i) => s + (i.quantity * (i.estimated_price ?? 0)), 0)
                          return (
                            <React.Fragment key={domain}>
                              {idx > 0 && (
                                <tr><td colSpan={4} className="h-4 bg-slate-100 dark:bg-slate-700" /></tr>
                              )}
                              <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                                <td colSpan={4} className="px-4 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="font-semibold text-slate-800 dark:text-slate-100 text-base">{domain}</p>
                                    <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
                                      Gesamt: <span className="font-semibold text-slate-700 dark:text-slate-200">€ {domainTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </span>
                                  </div>
                                </td>
                              </tr>
                              <tr className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                <th className="text-left text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-4 py-3">Artikel</th>
                                <th className="text-center text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Menge</th>
                                <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Einheit</th>
                                <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
                              </tr>
                              {domainItems.map(item => {
                                const price = item.estimated_price
                                const rowTotal = item.quantity * (price ?? 0)
                                return (
                                  <tr key={item.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800">
                                    <td className="px-4 py-3">
                                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[160px] md:max-w-xs">{item.product?.name ?? '—'}</p>
                                      {item.product?.brand && (
                                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.product.brand}</p>
                                      )}
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                      <span className="font-semibold text-slate-800 dark:text-slate-100">{item.quantity}</span>
                                    </td>
                                    <td className="px-3 py-3 text-right hidden sm:table-cell">
                                      <span className="text-sm text-slate-600 dark:text-slate-300">
                                        {price != null ? `€ ${price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-3 text-right font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                                      {price != null ? `€ ${rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>

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
            <>
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
            </>
          )}
          </>
        )}
      </div>

      {/* ── Sticky footer ── */}
      {tab === 'cart' && cartItems.length > 0 && grandTotal > 2000 && (
        <div className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
          <div className="px-4 py-4 flex items-center justify-between gap-4">
            <button
              onClick={submitCartForApproval}
              disabled={submittingApproval || pendingOrders.length > 0 || rejectedOrders.length > 0}
              className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
            >
              {submittingApproval
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : pendingOrders.length > 0 ? <Clock size={16} /> : <CheckCircle size={16} />
              }
              {pendingOrders.length > 0 ? 'Wartet auf Freigabe' : 'Zur Freigabe einreichen'}
            </button>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100 shrink-0">
              € {grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="h-20 md:hidden" />
        </div>
      )}
      {tab === 'cart' && cartItems.length > 0 && grandTotal <= 2000 && (
        <div className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Gesamtsumme Warenkorb</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">
              € {grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="h-20 md:hidden" />
        </div>
      )}
      {tab === 'approval' && role === 'admin' && pendingOrders.length > 0 && (() => {
        const order = pendingOrders[0]
        const total = order.total_estimate ?? (order.items ?? []).reduce((s, i) => s + (i.quantity * (i.estimated_price ?? 0)), 0)
        const busy = approvingOrder === order.id
        return (
          <div className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
            <div className="px-4 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openRejectModal(order)}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                >
                  <XCircle size={16} />
                  Ablehnen
                </button>
                <button
                  onClick={() => approveOrder(order.id)}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                >
                  {busy ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><CheckCircle size={16} />Freigeben</>}
                </button>
              </div>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 shrink-0">
                € {total.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="h-20 md:hidden" />
          </div>
        )
      })()}
      {tab === 'open' && orders.length > 0 && (() => {
        const openTotal = orders.reduce((s, o) => s + (o.total_estimate ?? (o.items ?? []).reduce((si, i) => si + i.quantity * (i.estimated_price ?? 0), 0)), 0)
        return (
          <div className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Gesamtsumme Bestellungen</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">
                € {openTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="h-20 md:hidden" />
          </div>
        )
      })()}

      {/* Edit cart item panel */}
      {(editItem || editClosing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closeEditPanel} />
          <div className={`fixed inset-0 bg-white dark:bg-slate-900 z-50 flex flex-col md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[400px] md:rounded-2xl md:shadow-2xl ${editClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="font-semibold text-slate-800 dark:text-slate-100 truncate flex-1 mr-2">{editItem?.product?.name}</h2>
              <button onClick={closeEditPanel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Menge</label>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, quantity: Math.max(1, f.quantity - 1) }))}
                      className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors shrink-0">
                      <Minus size={13} />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.quantity}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n > 0) setEditForm(f => ({ ...f, quantity: n })) }}
                      onFocus={e => e.target.select()}
                      className="w-full text-center border border-slate-300 dark:border-slate-600 rounded-lg py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button type="button" onClick={() => setEditForm(f => ({ ...f, quantity: f.quantity + 1 }))}
                      className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors shrink-0">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Listenpreis (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editForm.price}
                    onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                    onFocus={e => e.target.select()}
                    placeholder="0,00"
                    className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Pricing summary */}
              {(() => {
                const isHS = editItem?.product?.preferred_supplier === HS_SUPPLIER
                const prevListTotal = (editItem?.quantity ?? 0) * (editItem?.product?.last_price ?? 0)
                const prevEff = hsEffectivePrice(editItem?.product) ?? (editItem?.product?.last_price ?? 0)
                const prevEffTotal = (editItem?.quantity ?? 0) * prevEff
                const newListPrice = parseFloat(editForm.price.replace(',', '.'))
                const newEffPrice = isNaN(newListPrice) ? 0 : (() => {
                  if (!isHS) return newListPrice
                  const discount = editItem?.product?.brand === 'Henry Schein' ? 0.29 : 0.28
                  return newListPrice * (1 - discount)
                })()
                const newListTotal = editForm.quantity * (isNaN(newListPrice) ? 0 : newListPrice)
                const newEffTotal = editForm.quantity * newEffPrice
                const fmt = (n: number) => `€ ${Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                return (
                  <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-500 dark:text-slate-400">
                      <span>Vorher</span>
                      <span className="flex items-center gap-2">
                        {isHS && <span className="line-through text-slate-400 dark:text-slate-500">{fmt(prevListTotal)}</span>}
                        <span>{fmt(prevEffTotal)}</span>
                      </span>
                    </div>
                    <div className="flex justify-between font-medium text-slate-800 dark:text-slate-100">
                      <span>Neu</span>
                      <span className="flex items-center gap-2">
                        {isHS && <span className="line-through text-slate-400 dark:text-slate-500 font-normal">{fmt(newListTotal)}</span>}
                        <span>{fmt(newEffTotal)}</span>
                      </span>
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closeEditPanel}
                className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
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

      {/* Reject order modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => !rejecting && setRejectModal(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">Bestellung ablehnen</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Die Artikel werden zurück in den Warenkorb gelegt. Optional können Sie einen Grund angeben.
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Begründung (optional)…"
              rows={3}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setRejectModal(null)}
                disabled={rejecting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmReject}
                disabled={rejecting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {rejecting
                  ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : 'Ablehnen & zurück'
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">Aus Warenkorb entfernen?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              <span className="font-medium text-slate-700 dark:text-slate-200">{deleteConfirm.product?.name}</span> wird aus dem Warenkorb gelöscht.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
        <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none"><div className={`pointer-events-auto flex items-center gap-3 ${toast.variant === 'error' ? 'bg-red-500' : 'bg-slate-800'} text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg max-w-[calc(100vw-2rem)]`}>
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

      {/* Price compare modal */}
      {priceModal && (
        <PriceCompareModal
          item={priceModal}
          alternatives={priceHits[priceModal.product_id] ?? []}
          onClose={() => setPriceModal(null)}
          onApply={applyAlternative}
        />
      )}

      {/* ── Draggable scan modal ── */}
      {scanToggle && (
        <div
          className="fixed z-50 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden select-none"
          style={{ left: dragPos.x, top: dragPos.y, width: 320 }}
        >
          {/* Drag handle */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-transparent cursor-grab active:cursor-grabbing touch-none"
            onMouseDown={onDragStart}
            onTouchStart={onDragStart}
          >
            <div className="flex items-center gap-2">
              <ScanLine size={15} className="text-slate-400" />
              <span className="text-slate-700 dark:text-white text-sm font-medium">Scannen</span>
            </div>
            <div className="flex items-center gap-1">
              {einbuchenTorchSupported && (
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onTouchStart={e => e.stopPropagation()}
                  onClick={toggleEinbuchenTorch}
                  className={`p-1 rounded transition-colors ${einbuchenTorchOn ? 'text-amber-400' : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'}`}
                >
                  {einbuchenTorchOn ? <Flashlight size={16} /> : <FlashlightOff size={16} />}
                </button>
              )}
              <button
                onMouseDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onClick={handleToggleScan}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors p-1 rounded"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Camera */}
          <div className="relative bg-slate-900" style={{ minHeight: 220 }}>
            <div id={EINBUCHEN_SCAN_DIV} className="w-full" style={{ minHeight: 220 }} />
            {scanFlashError && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-red-500/80">
                <p className="text-white text-sm font-medium text-center px-4">Artikel nicht in offenen Bestellungen gefunden</p>
              </div>
            )}
          </div>
          <form
            onSubmit={async e => {
              e.preventDefault()
              const val = einbuchenManual.trim()
              if (!val) return
              setEinbuchenManual('')
              stopInlineScanner()
              const found = await processEinbuchenBarcode(val)
              if (!found) {
                showToast('Artikel nicht in offenen Bestellungen gefunden')
                setScanFlashError(true)
                await new Promise(r => setTimeout(r, 800))
                setScanFlashError(false)
              }
              if (scanToggleRef.current) startInlineScanner()
            }}
            className="px-3 py-2 bg-slate-100 dark:bg-slate-900 flex gap-2"
          >
            <input
              type="text"
              value={einbuchenManual}
              onChange={e => setEinbuchenManual(e.target.value)}
              placeholder="Barcode manuell eingeben…"
              className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="submit"
              disabled={!einbuchenManual.trim()}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-medium transition-colors"
            >
              OK
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Cart item row ───────────────────────────────────────────────────────────
function CartItemRow({ item, placing, requiresApproval, onUpdateQuantity, onPlaceOrder, onRemoveRequest, onEdit, alternatives, onShowAlternatives }: {
  item: CartItem
  placing: boolean
  requiresApproval: boolean
  onUpdateQuantity: (id: string, qty: number) => void
  onPlaceOrder: (item: CartItem) => void
  onRemoveRequest: (item: CartItem) => void
  onEdit: (item: CartItem) => void
  alternatives?: PriceAlternative[]
  onShowAlternatives?: (item: CartItem) => void
}) {
  const listPrice = item.product?.last_price ?? null
  const effectivePrice = hsEffectivePrice(item.product)
  const price = effectivePrice
  const hasDiscount = effectivePrice != null && listPrice != null && effectivePrice < listPrice
  const rowTotal = item.quantity * (effectivePrice ?? 0)
  const cheaperAlts = (alternatives ?? []).filter(a => effectivePrice != null && a.price < effectivePrice)

  return (
    <tr className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[160px] md:max-w-xs">{item.product?.name}</p>
          {item.is_edited && (
            <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">Aktualisiert</span>
          )}
        </div>
        {item.product?.brand && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.product.brand}</p>
        )}
        {cheaperAlts.length > 0 && (
          <button
            onClick={() => onShowAlternatives?.(item)}
            className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <TrendingDown size={13} />
            {cheaperAlts.length === 1 ? 'Günstiger verfügbar' : `${cheaperAlts.length}× günstiger verfügbar`}
          </button>
        )}
      </td>
      {/* Current stock */}
      <td className="px-4 py-3 text-right hidden md:table-cell">
        <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.product?.current_stock ?? '—'}</span>
        {item.product?.unit && <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">{item.product.unit}</span>}
      </td>
      {/* Order quantity */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 justify-center">
          <button onClick={() => onUpdateQuantity(item.id, item.quantity - 1)} disabled={item.quantity === 0}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-30">
            <Minus size={11} />
          </button>
          <span className="w-7 text-center font-semibold text-slate-800 dark:text-slate-100">{item.quantity}</span>
          <button onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            <Plus size={11} />
          </button>
        </div>
      </td>
      {/* Price */}
      <td className="px-3 py-3 text-right hidden sm:table-cell w-28 whitespace-nowrap">
        {price != null ? (
          <div className="flex flex-col items-end tabular-nums">
            {hasDiscount && (
              <span className="text-xs text-slate-400 dark:text-slate-500 line-through">
                € {listPrice!.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
            <span className="text-sm text-slate-600 dark:text-slate-300">
              € {price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        ) : '—'}
      </td>
      {/* Row total */}
      <td className="px-3 py-3 text-right w-32 whitespace-nowrap">
        {price != null ? (
          <div className="flex flex-col items-end tabular-nums">
            {hasDiscount && (
              <span className="text-xs text-slate-400 dark:text-slate-500 line-through">
                € {(item.quantity * listPrice!).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              € {rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        ) : '—'}
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
          {!requiresApproval && item.quantity > 0 && (
            <button onClick={() => onPlaceOrder(item)} disabled={placing} title="Als bestellt markieren"
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors disabled:opacity-40">
              {placing
                ? <span className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin inline-block" />
                : <CheckCircle size={16} />
              }
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Tab button ─────────────────────────────────────────────────────────────
function TabButton({ active, onClick, badge, children }: {
  active: boolean; onClick: () => void; badge?: number | string | null; children: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className={`py-3 px-1 mr-6 text-sm font-medium inline-flex items-center gap-2 border-b-2 transition-colors ${
        active ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {children}
      {badge === null && (
        <span className="w-6 h-4 bg-slate-100 dark:bg-slate-700 rounded-full animate-pulse" />
      )}
      {badge != null && badge !== 0 && badge !== '' && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
          active ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
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
  const domain = order.supplier ?? items[0]?.product?.preferred_supplier ?? getDomain(items[0]?.product?.supplier_url) ?? 'Unbekannter Lieferant'
  const doneCount = items.filter(i => (scannedCounts[i.id] ?? 0) >= i.quantity).length
  const progressPct = items.length > 0 ? (doneCount / items.length) * 100 : 0

  return (
    <>
      {/* Spacer between supplier groups */}
      {!isFirstOverall && isFirstInGroup && <tr><td colSpan={7} className="h-4 bg-slate-100 dark:bg-slate-700" /></tr>}

      {/* Supplier header — shown once per group, includes progress + total */}
      {isFirstInGroup && (
        <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <td colSpan={7} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800 dark:text-slate-100 text-base">{domain}</p>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{doneCount}/{items.length}</span>
                </div>
                {order.total_estimate != null && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Gesamt: <span className="font-semibold text-slate-700 dark:text-slate-200">€ {order.total_estimate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Column headers — only once per supplier group */}
      {isFirstInGroup && (
        <tr className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <th className="text-left text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-4 py-3">Artikel</th>
          <th className="text-left text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Datum</th>
          <th className="text-center text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Bestellt</th>
          <th className="text-center text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gescannt</th>
          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Stück</th>
          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
          <th className="text-right text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Aktion</th>
        </tr>
      )}

      {/* Item rows */}
      {items.map(item => {
        const scanned = scannedCounts[item.id] ?? 0
        const done = scanned >= item.quantity
        const rowTotal = item.quantity * (item.estimated_price ?? 0)
        const orderDate = new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        return (
          <tr key={item.id} className={`border-b border-slate-100 dark:border-slate-800 transition-colors ${done ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
            <td className="px-4 py-3.5">
              <p className={`text-sm font-semibold truncate max-w-[180px] md:max-w-xs ${done ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}`}>{item.product?.name ?? '—'}</p>
              {item.product?.brand && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.product.brand}</p>}
            </td>
            <td className="px-3 py-3.5 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap hidden sm:table-cell">{orderDate}</td>
            <td className="px-3 py-3.5 text-center text-slate-500 dark:text-slate-400">{item.quantity}</td>
            <td className="px-3 py-3.5 text-center">
              {done ? (
                <span className="inline-flex items-center justify-center gap-1 text-slate-500 dark:text-slate-400 font-semibold">
                  <Check size={12} className="text-emerald-600" /> {item.quantity}
                </span>
              ) : scanned > 0 ? (
                <span className="font-semibold text-sky-600">{scanned}/{item.quantity}</span>
              ) : (
                <span className="text-slate-300 dark:text-slate-600">—</span>
              )}
            </td>
            <td className="px-3 py-3.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap hidden sm:table-cell">
              {item.estimated_price != null
                ? `€ ${item.estimated_price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </td>
            <td className="px-3 py-3.5 text-right font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
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

