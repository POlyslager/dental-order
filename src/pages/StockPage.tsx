import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Product, Role } from '../lib/types'
import ProductDetailPage from './ProductDetailPage'
import CategorySelect from '../components/CategorySelect'
import { Search, Plus, X, Camera, ChevronLeft, Activity, ChevronUp, ChevronDown, Package, PackageCheck, PackageX, TriangleAlert, Check } from 'lucide-react'

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
]

interface Props { role: Role | null; initialBarcode?: string | null; onBarcodeConsumed?: () => void }

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

export default function StockPage({ role: _role, initialBarcode, onBarcodeConsumed }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'ok' | 'low' | 'critical' | 'empty'>('all')
  const [sortKey, setSortKey] = useState<'name' | 'category' | 'article_number' | 'preferred_supplier' | 'current_stock' | 'status'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedBrand, setSelectedBrand] = useState<string>('all')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [, setAddedToCart] = useState<Set<string>>(new Set())

  const [scanning, setScanning] = useState(false)
  const [looking, setLooking] = useState(false)
  const [closingProduct, setClosingProduct] = useState(false)
  const [duplicateProduct, setDuplicateProduct] = useState<Product | null>(null)
  const [cartToast, setCartToast] = useState<string | null>(null)
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

    // Best-effort product lookup via GTIN
    if (barcode.length >= 8) {
      try {
        const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`)
        const data = await res.json()
        const item = data?.items?.[0]
        if (item) {
          setForm(f => ({
            ...f,
            name:               f.name               || item.title        || '',
            description:        f.description        || item.description  || '',
            preferred_supplier: f.preferred_supplier || item.brand        || '',
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
  }

  useEffect(() => { fetchProducts() }, [])
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
    setForm(EMPTY_FORM)
    setShowForm(false)
    setSaving(false)
    fetchProducts()
  }

  const categories = ['all', ...Array.from(new Set(products.map(p => p.category))).sort()]
  const brands = Array.from(new Set(products.map(p => p.preferred_supplier).filter((s): s is string => !!s))).sort()

  const stockHealth = {
    green:  products.filter(p => p.current_stock > p.min_stock * 1.5).length,
    orange: products.filter(p => p.current_stock > p.min_stock && p.current_stock <= p.min_stock * 1.5).length,
    red:    products.filter(p => p.current_stock <= p.min_stock && p.current_stock > 0).length,
    empty:  products.filter(p => p.current_stock <= 0).length,
  }

  const filtered = products.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()) ||
      (p.article_number?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchesStatus = (() => {
      if (selectedStatus === 'all')      return true
      if (selectedStatus === 'ok')       return p.current_stock > p.min_stock * 1.5
      if (selectedStatus === 'low')      return p.current_stock > p.min_stock && p.current_stock <= p.min_stock * 1.5
      if (selectedStatus === 'critical') return p.current_stock > 0 && p.current_stock <= p.min_stock
      if (selectedStatus === 'empty')    return p.current_stock <= 0
      return true
    })()
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchesBrand = selectedBrand === 'all' || p.preferred_supplier === selectedBrand
    return matchesSearch && matchesStatus && matchesCategory && matchesBrand
  })

  function stockRank(p: Product) {
    if (p.current_stock <= 0) return 3
    if (p.current_stock <= p.min_stock) return 2
    if (p.current_stock <= p.min_stock * 1.5) return 1
    return 0
  }

  const sorted = [...filtered].sort((a, b) => {
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
  })

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

  function closeForm() { stopBarcodeScanner(); setShowForm(false); setForm(EMPTY_FORM) }

  if (showForm && !selectedProduct) return (
    <div className="w-full animate-slide-in-right">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={closeForm} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 p-1 -ml-1">
          <ChevronLeft size={16} />
          Zurück
        </button>
        <h2 className="font-semibold text-slate-800 flex-1">Neuer Artikel</h2>
        {/* Scan button in header */}
        <button type="button" onClick={startBarcodeScanner} disabled={scanning}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-600 disabled:opacity-40 transition-colors">
          <Camera size={16} />
          {form.barcode ? 'Barcode: ' + form.barcode : 'Barcode scannen'}
        </button>
      </header>

      {/* Scanner view */}
      {scanning && (
        <div className="relative bg-slate-900" style={{ height: 'calc(100dvh - 57px)' }}>
          <div id="barcode-scanner" className="w-full h-full" />
          <button type="button" onClick={stopBarcodeScanner}
            className="absolute top-4 left-4 bg-black/40 backdrop-blur-sm text-white rounded-full px-4 py-2 text-sm flex items-center gap-2 z-10">
            <X size={14} /> Abbrechen
          </button>
        </div>
      )}

      {/* Form */}
      {!scanning && (
        <form onSubmit={handleCreate} className="p-4 pb-10 space-y-4 max-w-2xl">
          <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Kategorie *</label>
            <CategorySelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} categories={categories.filter(c => c !== 'all')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meldebestand *" inputMode="numeric" value={form.min_stock} onChange={v => setForm(f => ({ ...f, min_stock: v }))} required />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
              <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <Field label="Stückpreis (€)" inputMode="decimal" value={form.last_price} onChange={v => setForm(f => ({ ...f, last_price: v }))} />
          <Field label="Beschreibung" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
          <Field label="Artikelnummer" value={form.article_number} onChange={v => setForm(f => ({ ...f, article_number: v }))} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lagerort</label>
            <select value={form.storage_location} onChange={e => setForm(f => ({ ...f, storage_location: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">— Kein Lagerort —</option>
              {STORAGE_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lieferant / Hersteller</label>
            <CategorySelect
              value={form.preferred_supplier}
              onChange={v => setForm(f => ({ ...f, preferred_supplier: v }))}
              categories={brands}
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
          <Field label="Beschreibung" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} rows={3} />
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
      )}
    </div>
  )


      {/* Duplicate barcode modal — rendered here so it works inside the early return */}
      {duplicateProduct && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-slide-in-up">
            <h3 className="font-semibold text-slate-800 text-lg mb-1">Artikel bereits vorhanden</h3>
            <p className="text-sm text-slate-500 mb-5">
              <span className="font-medium text-slate-700">{duplicateProduct.name}</span> ist bereits in deinem Inventar.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDuplicateProduct(null)}
                className="flex-1 border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={() => { setSelectedProduct(duplicateProduct); setShowForm(false); setDuplicateProduct(null) }}
                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
                Zum Artikel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

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
      setProducts(prev => prev.filter(p => p.id !== id))
      closeProduct()
    },
    onAddToCart: addToCart,
    onCartItemAdded: (name: string) => {
      closeProduct()
      setCartToast(`${name} wurde zum Warenkorb hinzugefügt`)
    },
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
        <select
          value={selectedStatus}
          onChange={e => { setSelectedStatus(e.target.value as typeof selectedStatus); setPage(1) }}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 shrink-0"
        >
          <option value="all">Alle Status</option>
          <option value="ok">Verfügbar</option>
          <option value="low">Knapp</option>
          <option value="critical">Niedriger Bestand</option>
          <option value="empty">Kein Bestand</option>
        </select>

        {/* Category filter */}
        <select
          value={selectedCategory}
          onChange={e => { setSelectedCategory(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 shrink-0"
        >
          <option value="all">Alle Kategorien</option>
          {categories.filter(c => c !== 'all').map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Supplier filter */}
        <select
          value={selectedBrand}
          onChange={e => { setSelectedBrand(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 shrink-0"
        >
          <option value="all">Alle Lieferanten</option>
          {brands.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        {/* Add button — pushed to end */}
        <button
          onClick={() => setShowForm(true)}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium whitespace-nowrap shrink-0"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Neuer Artikel</span>
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed">
          <colgroup>
            <col style={{ width: '30%' }} />
            <col className="hidden md:table-column" style={{ width: '18%' }} />
            <col className="hidden md:table-column" style={{ width: '12%' }} />
            <col className="hidden md:table-column" style={{ width: '18%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-white">
              <Th label="Name"      col="name"               onClick={toggleSort} SortIcon={SortIcon} />
              <Th label="Kategorie" col="category"           onClick={toggleSort} SortIcon={SortIcon} className="hidden md:table-cell" />
              <Th label="Artikelnr." col="article_number"    onClick={toggleSort} SortIcon={SortIcon} className="hidden md:table-cell" />
              <Th label="Lieferant" col="preferred_supplier" onClick={toggleSort} SortIcon={SortIcon} className="hidden md:table-cell" />
              <Th label="Bestand"   col="current_stock"      onClick={toggleSort} SortIcon={SortIcon} align="right" />
              <Th label="Status"    col="status"             onClick={toggleSort} SortIcon={SortIcon} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.map(p => (
              <tr
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                className={`bg-white hover:bg-slate-50 cursor-pointer transition-colors ${selectedProduct?.id === p.id ? 'bg-sky-50' : ''}`}
              >
                <td className="px-4 py-3.5">
                  <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400 md:hidden mt-0.5">{p.category}</p>
                </td>
                <td className="hidden md:table-cell px-4 py-3.5 text-sm text-slate-500 truncate">{p.category}</td>
                <td className="hidden md:table-cell px-4 py-3.5 text-sm text-slate-500 truncate">{p.article_number ?? '—'}</td>
                <td className="hidden md:table-cell px-4 py-3.5 text-sm text-slate-500 truncate">{p.preferred_supplier ?? '—'}</td>
                <td className="px-4 py-3.5 text-right">
                  <span className="text-sm font-bold text-slate-800">{p.current_stock}</span>
                  <span className="text-xs text-slate-400 ml-1">{p.unit}</span>
                </td>
                <td className="px-4 py-3.5"><StockStatus product={p} /></td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">Keine Artikel gefunden</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination (md+) */}
      {totalPages > 1 && (
        <div className="hidden md:flex items-center px-4 py-3 border-t border-slate-100 bg-white">
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
      {cartToast && <CartToast message={cartToast} onClose={() => setCartToast(null)} />}

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

// ── Sortable table header ────────────────────────────────────────────────────
function Th({ label, col, onClick, SortIcon, align, className = '' }: {
  label: string
  col: string
  onClick: (col: never) => void
  SortIcon: (props: { col: never }) => React.ReactElement
  align?: 'right'
  className?: string
}) {
  return (
    <th
      onClick={() => onClick(col as never)}
      className={`${align === 'right' ? 'text-right' : 'text-left'} text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3 cursor-pointer select-none hover:text-slate-600 transition-colors ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon col={col as never} />
      </span>
    </th>
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

// ── Cart toast ───────────────────────────────────────────────────────────────
function CartToast({ message, onClose }: { message: string; onClose: () => void }) {
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

