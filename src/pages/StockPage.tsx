import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Product, Role } from '../lib/types'
import ProductDetailPage from './ProductDetailPage'
import CategorySelect from '../components/CategorySelect'
import { Search, Plus, X, Camera, Activity, ChevronUp, ChevronDown, Package, PackageCheck, PackageX, TriangleAlert, Check, ShoppingCart } from 'lucide-react'

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
]

interface Props { role: Role | null; initialBarcode?: string | null; onBarcodeConsumed?: () => void; onNavigateToOrders?: () => void }

const EMPTY_FORM = {
  article_number: '', name: '', description: '', category: '', barcode: '',
  current_stock: '', min_stock: '', unit: 'pcs', preferred_supplier: '', supplier_url: '',
  producer_url: '', last_price: '', storage_location: '', notes: '',
}
const STORAGE_LOCATIONS = [
  'Behandlungsraum 1', 'Behandlungsraum 2', 'Behandlungsraum 3',
  'Behandlungsraum 4', 'Behandlungsraum 5',
  'Steri', 'Rezeption', 'Büro', 'Radiologie', 'Keller',
]
const UNITS = ['Stück', 'Packung', 'Flasche', 'Kanister']

export default function StockPage({ role: _role, initialBarcode, onBarcodeConsumed, onNavigateToOrders }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'ok' | 'low' | 'critical' | 'empty' | 'in_order'>('all')
  const [sortKey, setSortKey] = useState<'name' | 'category' | 'article_number' | 'preferred_supplier' | 'current_stock' | 'status'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set())
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [, setAddedToCart] = useState<Set<string>>(new Set())
  const [cartProductIds, setCartProductIds] = useState<Set<string>>(new Set())
  const [orderedProductIds, setOrderedProductIds] = useState<Set<string>>(new Set())

  const [scanning, setScanning] = useState(false)
  const [looking, setLooking] = useState(false)
  const [closingProduct, setClosingProduct] = useState(false)
  const [closingForm, setClosingForm] = useState(false)
  const [duplicateProduct, setDuplicateProduct] = useState<Product | null>(null)
  const [cartToast, setCartToast] = useState<string | null>(null)
  const [cartToastAction, setCartToastAction] = useState<(() => void) | null>(null)
  const [cartToastUndo, setCartToastUndo] = useState<(() => void) | null>(null)
  const [suppliers, setSuppliers] = useState<string[]>([])
  const scannerRef = useRef<Html5Qrcode | null>(null)

  async function startBarcodeScanner() {
    // flushSync ensures the div is visible in the DOM before Html5Qrcode attaches
    flushSync(() => setScanning(true))

    const scanner = new Html5Qrcode('barcode-scanner', { formatsToSupport: SCAN_FORMATS, verbose: false })
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.85, height: Math.min(w, h) * 0.85 }) },
        async (raw) => {
          await scanner.stop()
          scannerRef.current = null
          setScanning(false)
          await applyScannedCode(raw)
        },
        () => {}
      )
    } catch {
      setScanning(false)
    }
  }

  async function applyScannedCode(raw: string) {
    const clean = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()

    // Parse GS1 fields if present
    const gtin14 = clean.match(/^01(\d{14})/)
    const barcode = gtin14 ? gtin14[1] : clean

    // Parse optional GS1 fields: lot (10), expiry (17)
    const lot    = clean.match(/10([^\x1d]{1,20})/)
    const expiry = clean.match(/17(\d{6})/)
    let notes = ''
    if (lot)    notes += `Charge: ${lot[1]}`
    if (expiry) notes += (notes ? ' · ' : '') + `Ablauf: 20${expiry[1].slice(0,2)}-${expiry[1].slice(2,4)}-${expiry[1].slice(4,6)}`

    // Check if product with this barcode already exists
    const { data: existing } = await supabase.from('products').select('*').eq('barcode', barcode).maybeSingle()
    if (existing) {
      setDuplicateProduct(existing as Product)
      return
    }

    setForm(f => ({ ...f, barcode, notes: f.notes || notes }))

    // Best-effort product lookup via GTIN (proxied to avoid CORS)
    if (barcode.length >= 8) {
      try {
        const res = await fetch('/api/lookup-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upc: barcode }),
        })
        const data = await res.json()
        if (data.found) {
          setForm(f => ({
            ...f,
            name:               f.name               || data.name  || '',
            notes:              f.notes              || data.description || '',
            preferred_supplier: f.preferred_supplier || data.brand || '',
          }))
        }
      } catch { /* silently ignore — lookup is best-effort */ }
    }
  }

  function stopBarcodeScanner() {
    if (scannerRef.current?.isScanning) scannerRef.current.stop()
    scannerRef.current = null
    setScanning(false)
  }

  async function lookupProduct() {
    setLooking(true)
    try {
      const res = await fetch('/api/lookup-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierUrl: form.supplier_url,
          query: form.article_number || form.name,
        }),
      })
      const data = await res.json()
      if (data.found) {
        setForm(f => ({
          ...f,
          name:               f.name               || data.name        || '',
          notes:              f.notes              || data.description  || '',
          preferred_supplier: f.preferred_supplier || data.brand        || '',
          article_number:     f.article_number     || data.sku          || '',
          last_price:         f.last_price         || (data.price != null ? String(data.price) : ''),
          supplier_url:       f.supplier_url       || data.productUrl   || '',
        }))
      }
    } catch { /* silently ignore */ }
    setLooking(false)
  }

  async function addToCart(productId: string, quantity: number) {
    const user = await getCurrentUser()
    if (!user) return
    const { data: existing } = await supabase
      .from('cart_items').select('id, quantity').eq('product_id', productId).maybeSingle()
    if (existing) {
      await supabase.from('cart_items').update({ quantity: existing.quantity + quantity }).eq('id', existing.id)
    } else {
      await supabase.from('cart_items').insert({ product_id: productId, quantity, added_by: user.id })
    }
    setAddedToCart(prev => new Set(prev).add(productId))
    setTimeout(() => setAddedToCart(prev => { const s = new Set(prev); s.delete(productId); return s }), 2000)
    setCartProductIds(prev => new Set(prev).add(productId))
  }

  async function fetchCartProductIds() {
    const [{ data: cartData }, { data: openOrders }] = await Promise.all([
      supabase.from('cart_items').select('product_id'),
      supabase.from('orders').select('id').eq('status', 'ordered'),
    ])
    setCartProductIds(new Set((cartData ?? []).map(i => i.product_id)))
    const openOrderIds = (openOrders ?? []).map(o => o.id)
    if (openOrderIds.length > 0) {
      const { data: orderItems } = await supabase
        .from('order_items').select('product_id').in('order_id', openOrderIds)
      setOrderedProductIds(new Set((orderItems ?? []).map(i => i.product_id)))
    } else {
      setOrderedProductIds(new Set())
    }
  }

  useEffect(() => {
    fetchProducts(); fetchSuppliers(); fetchCartProductIds()
    let lastFetch = Date.now()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > 60_000) {
        lastFetch = Date.now()
        fetchCartProductIds()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
useEffect(() => {
    if (initialBarcode) {
      setForm(f => ({ ...f, barcode: initialBarcode }))
      setShowForm(true)
      onBarcodeConsumed?.()
    }
  }, [initialBarcode])

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*').order('name')
    setProducts(data ?? [])
    setLoading(false)
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null)
    if (data) setSuppliers([...new Set(data.map(r => r.preferred_supplier as string))].filter(Boolean).sort())
  }

  async function upsertSupplier(name: string) {
    if (!name) return
    await supabase.from('suppliers').upsert({ name }, { onConflict: 'name' })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('products').insert({
      ...form,
      current_stock: parseFloat(form.current_stock) || 0,
      min_stock: parseFloat(form.min_stock) || 0,
      last_price: form.last_price ? parseFloat(form.last_price) : null,
      article_number: form.article_number || null,
      barcode: form.barcode || null,
      supplier_url: form.supplier_url || null,
      producer_url: form.producer_url || null,
      preferred_supplier: form.preferred_supplier || null,
      storage_location: form.storage_location || null,
      description: form.description || null,
      notes: form.notes || null,
    })
    const addedName = form.name
    if (form.preferred_supplier) {
      await upsertSupplier(form.preferred_supplier)
      fetchSuppliers()
    }
    setForm(EMPTY_FORM)
    setShowForm(false)
    setSaving(false)
    fetchProducts()
    setCartToastAction(null)
    setCartToastUndo(null)
    setCartToast(`${addedName} wurde zum Inventar hinzugefügt`)
  }

  const productCategories = useMemo(() => Array.from(new Set(products.map(p => p.category))).sort(), [products])
  const categories = useMemo(() => ['all', ...productCategories], [productCategories])
  const brands = suppliers

  const stockHealth = useMemo(() => ({
    green:  products.filter(p => p.current_stock > p.min_stock * 1.5).length,
    orange: products.filter(p => p.current_stock > p.min_stock && p.current_stock <= p.min_stock * 1.5).length,
    red:    products.filter(p => p.current_stock <= p.min_stock && p.current_stock > 0).length,
    empty:  products.filter(p => p.current_stock <= 0).length,
  }), [products])

  function stockRank(p: Product) {
    if (p.current_stock <= 0) return 3
    if (p.current_stock <= p.min_stock) return 2
    if (p.current_stock <= p.min_stock * 1.5) return 1
    return 0
  }

  const filtered = useMemo(() => products.filter(p => {
    const q = search.toLowerCase()
    const matchesSearch =
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.article_number?.toLowerCase().includes(q) ?? false)
    const matchesStatus = (() => {
      if (selectedStatus === 'all')      return true
      if (selectedStatus === 'ok')       return p.current_stock > p.min_stock * 1.5
      if (selectedStatus === 'low')      return p.current_stock > p.min_stock && p.current_stock <= p.min_stock * 1.5
      if (selectedStatus === 'critical') return p.current_stock > 0 && p.current_stock <= p.min_stock
      if (selectedStatus === 'empty')    return p.current_stock <= 0
      if (selectedStatus === 'in_order') return cartProductIds.has(p.id) || orderedProductIds.has(p.id)
      return true
    })()
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchesBrand = selectedBrands.size === 0 || selectedBrands.has(p.preferred_supplier ?? '')
    return matchesSearch && matchesStatus && matchesCategory && matchesBrand
  }), [products, search, selectedStatus, selectedCategory, selectedBrands, cartProductIds, orderedProductIds])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortKey) {
      case 'name':               return dir * a.name.localeCompare(b.name)
      case 'category':           return dir * a.category.localeCompare(b.category)
      case 'article_number':     return dir * (a.article_number ?? '').localeCompare(b.article_number ?? '')
      case 'preferred_supplier': return dir * (a.preferred_supplier ?? '').localeCompare(b.preferred_supplier ?? '')
      case 'current_stock':      return dir * (a.current_stock - b.current_stock)
      case 'status':             return dir * (stockRank(a) - stockRank(b))
      default:                   return 0
    }
  }), [filtered, sortKey, sortDir])

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <ChevronUp size={12} className="text-slate-300" />
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-sky-500" />
      : <ChevronDown size={12} className="text-sky-500" />
  }

  function closeForm() {
    stopBarcodeScanner()
    setClosingForm(true)
    setTimeout(() => { setShowForm(false); setClosingForm(false); setForm(EMPTY_FORM) }, 260)
  }


  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  function closeProduct() {
    setClosingProduct(true)
    setTimeout(() => { setSelectedProduct(null); setClosingProduct(false) }, 260)
  }

  const productDetailProps = selectedProduct ? {
    product: selectedProduct,
    onBack: closeProduct,
    onUpdated: (updated: Product) => {
      setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
      setSelectedProduct(updated)
    },
    onDeleted: (id: string) => {
      const deleted = { ...selectedProduct }
      setProducts(prev => prev.filter(p => p.id !== id))
      fetchProducts()
      closeProduct()
      setCartToastAction(null)
      setCartToastUndo(() => async () => {
        const { created_at, updated_at, ...fields } = deleted as any
        await supabase.from('products').insert(fields)
        fetchProducts()
        setCartToast(null)
        setCartToastUndo(null)
      })
      setCartToast(`${deleted.name} wurde gelöscht`)
    },
    onAddToCart: addToCart,
    onCartItemAdded: (name: string) => {
      closeProduct()
      setCartToastUndo(null)
      setCartToastAction(onNavigateToOrders ? () => onNavigateToOrders : null)
      setCartToast(`${name} wurde zum Warenkorb hinzugefügt`)
    },
    onItemTaken: (name: string) => {
      closeProduct()
      setCartToastAction(null)
      setCartToastUndo(null)
      setCartToast(`${name} wurde entnommen`)
      fetchProducts()
    },
    availableCategories: productCategories,
    availableSuppliers: suppliers,
  } : null

  return (
    <div className="w-full relative">
      {/* Lagergesundheit stat bar */}
      {products.length > 0 && (
        <div className="px-4 pt-4 pb-2">
          <div className="bg-white rounded-2xl border border-slate-100">
            <div className="flex divide-x divide-slate-100 overflow-x-auto">
              {([
                { count: products.length,    label: 'Artikel gesamt', icon: <Package size={20} />,       iconBg: 'bg-slate-100',    iconColor: 'text-slate-500',   filter: 'all'      as const, active: false },
                { count: stockHealth.green,  label: 'Verfügbar',      icon: <PackageCheck size={20} />,  iconBg: 'bg-emerald-100',  iconColor: 'text-emerald-600', filter: 'ok'       as const, active: selectedStatus === 'ok' },
                { count: stockHealth.orange, label: 'Knapp',          icon: <Activity size={20} />,      iconBg: 'bg-amber-100',    iconColor: 'text-amber-500',   filter: 'low'      as const, active: selectedStatus === 'low' },
                { count: stockHealth.red,    label: 'Niedriger Bestand', icon: <TriangleAlert size={20} />, iconBg: 'bg-orange-100', iconColor: 'text-orange-500',  filter: 'critical' as const, active: selectedStatus === 'critical' },
                { count: stockHealth.empty,  label: 'Kein Bestand',   icon: <PackageX size={20} />,      iconBg: 'bg-red-100',      iconColor: 'text-red-500',     filter: 'empty'    as const, active: selectedStatus === 'empty' },
              ]).map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => {
                    if (s.filter === 'all') { setSelectedStatus('all'); setPage(1) }
                    else { setSelectedStatus(p => p === s.filter ? 'all' : s.filter); setPage(1) }
                  }}
                  className={`flex-1 flex items-center gap-3 px-5 py-4 transition-colors min-w-0 shrink-0 ${
                    s.active ? 'bg-slate-50' : 'hover:bg-slate-50'
                  } ${i === 0 ? 'rounded-l-2xl' : ''} ${i === 4 ? 'rounded-r-2xl' : ''}`}
                >
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${s.iconBg} ${s.active ? 'ring-2 ring-offset-1 ring-slate-300' : ''}`}>
                    <span className={s.iconColor}>{s.icon}</span>
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-xs text-slate-500 truncate">{s.label}</p>
                    <p className="text-2xl font-bold text-slate-800 leading-tight">{s.count}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search + filters + add — single row */}
      <div className="px-4 pt-3 pb-3 flex gap-2 items-center flex-wrap">
        {/* Search */}
        <div className="relative w-52 shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Suchen…"
            className="w-full border border-slate-200 rounded-xl pl-8 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="relative shrink-0">
          <select
            value={selectedStatus}
            onChange={e => { setSelectedStatus(e.target.value as typeof selectedStatus); setPage(1) }}
            className="appearance-none border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Alle Status</option>
            <option value="ok">Verfügbar</option>
            <option value="low">Knapp</option>
            <option value="critical">Niedriger Bestand</option>
            <option value="empty">Kein Bestand</option>
            <option value="in_order">In Bestellung</option>
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Category filter */}
        <div className="relative shrink-0">
          <select
            value={selectedCategory}
            onChange={e => { setSelectedCategory(e.target.value); setPage(1) }}
            className="appearance-none border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Alle Kategorien</option>
            {categories.filter(c => c !== 'all').map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Supplier filter — multi-select */}
        <SupplierMultiSelect
          selected={selectedBrands}
          onChange={s => { setSelectedBrands(s); setPage(1) }}
          options={brands}
        />

        {/* Add button — pushed to end */}
        <button
          onClick={() => setShowForm(true)}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium whitespace-nowrap shrink-0"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Neuer Artikel</span>
        </button>
      </div>

      {/* Desktop header (md+) */}
      <div className="hidden md:grid border-b border-slate-200 bg-white sticky top-0 z-10" style={{ gridTemplateColumns: '1.7fr 1fr 1fr 0.8fr 1fr' }}>
        <ColHeader label="Name"      col="name"               onClick={toggleSort} SortIcon={SortIcon} />
        <ColHeader label="Kategorie" col="category"           onClick={toggleSort} SortIcon={SortIcon} />
        <ColHeader label="Lieferant" col="preferred_supplier" onClick={toggleSort} SortIcon={SortIcon} />
        <ColHeader label="Bestand"   col="current_stock"      onClick={toggleSort} SortIcon={SortIcon} />
        <ColHeader label="Status"    col="status"             onClick={toggleSort} SortIcon={SortIcon} />
      </div>

      {/* Mobile header */}
      <div className="flex md:hidden border-b border-slate-200 bg-white sticky top-0 z-10">
        <ColHeader label="Artikel"  col="name"          onClick={toggleSort} SortIcon={SortIcon} className="flex-1" />
        <ColHeader label="Bestand"  col="current_stock" onClick={toggleSort} SortIcon={SortIcon} align="right" className="w-24" />
        <ColHeader label="Status"   col="status"        onClick={toggleSort} SortIcon={SortIcon} className="w-28" />
      </div>

      {/* Rows */}
      <div className="divide-y divide-slate-100">
        {paginated.map(p => (
          <div
            key={p.id}
            onClick={() => setSelectedProduct(p)}
            className={`bg-white hover:bg-slate-50 cursor-pointer transition-colors ${selectedProduct?.id === p.id ? 'bg-sky-50' : ''}`}
          >
            {/* Desktop row */}
            <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '1.7fr 1fr 1fr 0.8fr 1fr' }}>
              <div className="min-w-0 px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                  {cartProductIds.has(p.id) && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full shrink-0">
                      <ShoppingCart size={10} /> Im Warenkorb
                    </span>
                  )}
                  {!cartProductIds.has(p.id) && orderedProductIds.has(p.id) && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full shrink-0">
                      <Package size={10} /> In Bestellung
                    </span>
                  )}
                </div>
              </div>
              <div className="min-w-0 px-4 py-3.5 text-sm text-slate-500 truncate">{p.category}</div>
              <div className="min-w-0 px-4 py-3.5 text-sm text-slate-500 truncate">{p.preferred_supplier ?? '—'}</div>
              <div className="px-4 py-3.5">
                <span className="text-sm font-bold text-slate-800">{p.current_stock}</span>
                <span className="text-xs text-slate-400 ml-1">{p.unit}</span>
              </div>
              <div className="px-4 py-3.5"><StockStatus product={p} /></div>
            </div>
            {/* Mobile row */}
            <div className="flex md:hidden items-center">
              <div className="flex-1 min-w-0 px-4 py-3.5">
                <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{p.category}</p>
              </div>
              <div className="w-24 px-4 py-3.5 text-right shrink-0">
                <span className="text-sm font-bold text-slate-800">{p.current_stock}</span>
                <span className="text-xs text-slate-400 ml-1">{p.unit}</span>
              </div>
              <div className="w-28 px-4 py-3.5 shrink-0"><StockStatus product={p} /></div>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="px-4 py-12 text-center text-slate-400 text-sm">Keine Artikel gefunden</p>
        )}
      </div>

      {/* Pagination (md+) */}
      {totalPages > 1 && (
        <div className="hidden md:flex items-center px-4 py-3 border-t border-slate-100 bg-white sticky bottom-0 z-10">
          <p className="text-xs text-slate-400 w-40 shrink-0">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} von {sorted.length} Artikeln
          </p>
          <div className="flex-1 flex items-center justify-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              «
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Zurück
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
              .reduce<(number | '…')[]>((acc, n, i, arr) => {
                if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…')
                acc.push(n)
                return acc
              }, [])
              .map((n, i) =>
                n === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-xs text-slate-300">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n as number)}
                    className={`w-8 h-7 text-xs rounded-lg transition-colors ${
                      page === n ? 'bg-sky-500 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {n}
                  </button>
                )
              )
            }
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Weiter
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              »
            </button>
          </div>
          <div className="w-40 shrink-0" />
        </div>
      )}

      {/* Cart toast */}
      {cartToast && <CartToast message={cartToast} onClose={() => { setCartToast(null); setCartToastUndo(null) }} onNavigate={cartToastAction ?? undefined} onUndo={cartToastUndo ?? undefined} />}

      {/* Duplicate barcode modal */}
      {duplicateProduct && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-slide-in-up">
            <h3 className="font-semibold text-slate-800 text-lg mb-1">Artikel bereits vorhanden</h3>
            <p className="text-sm text-slate-500 mb-5">
              <span className="font-medium text-slate-700">{duplicateProduct.name}</span> ist bereits in deinem Inventar.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDuplicateProduct(null)}
                className="flex-1 border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => { setSelectedProduct(duplicateProduct); setDuplicateProduct(null) }}
                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
              >
                Zum Artikel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New article form — slide-in panel */}
      {(showForm || closingForm) && !selectedProduct && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closeForm} />
          <div className={`fixed inset-0 bg-white z-50 overflow-y-auto md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl ${closingForm ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h2 className="font-semibold text-slate-800">Neuer Artikel</h2>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Scanner modal */}
            {scanning && (
              <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60">
                <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <span className="font-semibold text-slate-800 text-sm">Barcode scannen</span>
                    <button type="button" onClick={stopBarcodeScanner}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                  <div id="barcode-scanner" className="w-full bg-slate-900" style={{ minHeight: 260 }} />
                  <p className="text-center text-xs text-slate-400 py-2 bg-slate-900">Barcode vor die Kamera halten</p>
                </div>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleCreate} className="p-4 pb-10 space-y-4">
              <button type="button" onClick={startBarcodeScanner} disabled={scanning}
                className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-medium rounded-xl py-3 text-sm transition-colors">
                <Camera size={18} />
                {form.barcode ? 'Barcode gescannt ✓' : 'Barcode scannen'}
              </button>
              <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kategorie *</label>
                <CategorySelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} categories={productCategories} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Bestand" inputMode="numeric" value={form.current_stock} onChange={v => setForm(f => ({ ...f, current_stock: v }))} />
                <Field label="Meldebestand *" inputMode="numeric" value={form.min_stock} onChange={v => setForm(f => ({ ...f, min_stock: v }))} required />
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
                  <div className="relative">
                    <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                      className="w-full appearance-none border border-slate-300 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500">
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Artikelnummer" value={form.article_number} onChange={v => setForm(f => ({ ...f, article_number: v }))} />
                <Field label="Stückpreis (€)" inputMode="decimal" value={form.last_price} onChange={v => setForm(f => ({ ...f, last_price: v }))} />
              </div>
              <Field label="Beschreibung" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} rows={3} />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Lagerort</label>
                <div className="relative">
                  <select value={form.storage_location} onChange={e => setForm(f => ({ ...f, storage_location: e.target.value }))}
                    className="w-full appearance-none border border-slate-300 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="">— Kein Lagerort —</option>
                    {STORAGE_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Lieferant / Hersteller</label>
                <CategorySelect
                  value={form.preferred_supplier}
                  onChange={v => setForm(f => ({ ...f, preferred_supplier: v }))}
                  categories={suppliers}
                  placeholder="Lieferant suchen…"
                  newLabel="als neuer Lieferant"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Bestell-Website</label>
                <div className="flex gap-2">
                  <input type="url" value={form.supplier_url}
                    onChange={e => setForm(f => ({ ...f, supplier_url: e.target.value }))}
                    placeholder="https://…"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  {(form.supplier_url || form.preferred_supplier) && (form.name || form.article_number) && (
                    <button type="button" onClick={lookupProduct} disabled={looking}
                      className="px-3 py-2 rounded-lg border border-sky-300 text-sky-600 hover:bg-sky-50 disabled:opacity-40 text-xs font-medium whitespace-nowrap transition-colors">
                      {looking ? '…' : '↗ Nachschlagen'}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeForm}
                  className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  Abbrechen
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm">
                  {saving ? 'Speichern…' : 'Hinzufügen'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Product detail — full-screen on mobile, side panel modal on md+ */}
      {(selectedProduct || closingProduct) && productDetailProps && (
        <>
          <div
            className={`hidden md:block fixed inset-0 bg-black/30 z-40 ${closingProduct ? 'animate-fade-in' : 'animate-fade-in'}`}
            onClick={closeProduct}
          />
          <div className={`fixed inset-0 bg-white z-50 overflow-y-auto md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl ${closingProduct ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <ProductDetailPage {...productDetailProps} isModal />
          </div>
        </>
      )}
    </div>
  )
}

// ── Sortable column header (flex-based) ──────────────────────────────────────
function ColHeader({ label, col, onClick, SortIcon, align, className = '' }: {
  label: string
  col: string
  onClick: (col: never) => void
  SortIcon: (props: { col: never }) => React.ReactElement
  align?: 'right'
  className?: string
}) {
  return (
    <button
      onClick={() => onClick(col as never)}
      className={`flex items-center gap-1 px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer select-none hover:text-slate-600 transition-colors ${align === 'right' ? 'justify-end' : 'justify-start'} ${className}`}
    >
      {label}
      <SortIcon col={col as never} />
    </button>
  )
}

// ── Stock status badge ──────────────────────────────────────────────────────
function StockStatus({ product: p }: { product: Product }) {
  if (p.current_stock <= 0)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500"><span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />Kein Bestand</span>
  if (p.current_stock <= p.min_stock)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-500"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />Niedriger Bestand</span>
  if (p.current_stock <= p.min_stock * 1.5)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />Knapp</span>
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />Verfügbar</span>
}

function Field({ label, value, onChange, type = 'text', required = false, inputMode, rows }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  rows?: number
}) {
  const cls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500'
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {rows
        ? <textarea value={value} onChange={e => onChange(e.target.value)} required={required} rows={rows} className={`${cls} resize-none`} />
        : <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            required={required}
            inputMode={inputMode}
            pattern={inputMode === 'numeric' ? '[0-9]*' : undefined}
            className={cls}
          />
      }
    </div>
  )
}

// ── Searchable select dropdown ────────────────────────────────────────────────
function SupplierMultiSelect({ selected, onChange, options }: {
  selected: Set<string>
  onChange: (s: Set<string>) => void
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

  const filtered = options.filter(o => o.toLowerCase().includes(q.toLowerCase()))

  function toggle(o: string) {
    const next = new Set(selected)
    if (next.has(o)) next.delete(o)
    else next.add(o)
    onChange(next)
  }

  const label = selected.size === 0
    ? 'Alle Lieferanten'
    : selected.size === 1
    ? [...selected][0]
    : `${selected.size} Lieferanten`

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQ('') }}
        className={`border rounded-xl pl-3 pr-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 flex items-center gap-2 min-w-[140px] justify-between ${
          selected.size > 0 ? 'border-sky-400 text-sky-700' : 'border-slate-200 text-slate-700'
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 w-64 animate-slide-in-up">
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
            <li>
              <button type="button" onClick={() => onChange(new Set())}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2.5 text-slate-700">
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${selected.size === 0 ? 'bg-sky-500 border-sky-500' : 'border-slate-300'}`}>
                  {selected.size === 0 && <Check size={10} className="text-white" />}
                </span>
                <span className={selected.size === 0 ? 'font-semibold text-sky-600' : ''}>Alle Lieferanten</span>
              </button>
            </li>
            {filtered.map(o => (
              <li key={o}>
                <button type="button" onClick={() => toggle(o)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2.5 text-slate-700">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${selected.has(o) ? 'bg-sky-500 border-sky-500' : 'border-slate-300'}`}>
                    {selected.has(o) && <Check size={10} className="text-white" />}
                  </span>
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

// ── Cart toast ───────────────────────────────────────────────────────────────
function CartToast({ message, onClose, onNavigate, onUndo }: { message: string; onClose: () => void; onNavigate?: () => void; onUndo?: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [message, onClose])
  return (
    <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none">
      <div className="pointer-events-auto bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-4 flex items-center gap-3 animate-slide-in-down max-w-[calc(100vw-2rem)]">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
          <Check size={16} className="text-emerald-400" />
        </div>
        <p className="flex-1 text-sm font-medium leading-snug">{message}</p>
        {onUndo && (
          <button onClick={() => { onUndo(); onClose() }}
            className="text-sky-400 hover:text-sky-300 text-xs font-medium whitespace-nowrap transition-colors shrink-0">
            Rückgängig
          </button>
        )}
        {onNavigate && (
          <button onClick={() => { onNavigate(); onClose() }}
            className="text-sky-400 hover:text-sky-300 text-xs font-medium whitespace-nowrap transition-colors shrink-0">
            Zur Bestellung →
          </button>
        )}
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

