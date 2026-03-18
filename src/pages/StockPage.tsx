import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Product, Role } from '../lib/types'
import ProductDetailPage from './ProductDetailPage'
import CategorySelect from '../components/CategorySelect'
import { Search, Plus, X, ShoppingCart, Check, Camera, ArrowLeft } from 'lucide-react'

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
]

interface Props { role: Role | null; initialBarcode?: string | null; onBarcodeConsumed?: () => void }

type Filter = 'all' | 'kritisch' | 'niedrig'

function isLowStock(p: Product) { return p.current_stock <= p.min_stock }
function isNearThreshold(p: Product) { return !isLowStock(p) && p.current_stock <= p.min_stock * 1.5 }

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
const UNITS = [
  'Stück', 'Packung', 'Box', 'Kartusche', 'Flasche', 'Tube',
  'Beutel', 'Spritze', 'Set', 'Kit', 'Kanister', 'Dose', 'Ries', 'Paar', 'Rolle',
]

export default function StockPage({ role: _role, initialBarcode, onBarcodeConsumed }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
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

  const kritischCount = products.filter(isLowStock).length
  const niedrigCount  = products.filter(isNearThreshold).length

  const filtered = products.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()) ||
      (p.article_number?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchesFilter =
      filter === 'all'      ? true :
      filter === 'kritisch' ? isLowStock(p) :
                              isNearThreshold(p)
    return matchesSearch && matchesCategory && matchesFilter
  })

  // Sort within each group by urgency (ratio of current to min, ascending)
  const byUrgency = (a: Product, b: Product) =>
    (a.current_stock / Math.max(a.min_stock, 1)) - (b.current_stock / Math.max(b.min_stock, 1))

  const kritisch  = filtered.filter(p => isLowStock(p)).sort(byUrgency)
  const niedrig   = filtered.filter(p => isNearThreshold(p)).sort(byUrgency)
  const ok        = filtered.filter(p => !isLowStock(p) && !isNearThreshold(p)).sort(byUrgency)

  if (selectedProduct) return (
    <ProductDetailPage
      product={selectedProduct}
      onBack={() => setSelectedProduct(null)}
      onUpdated={updated => {
        setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
        setSelectedProduct(updated)
      }}
      onDeleted={id => {
        setProducts(prev => prev.filter(p => p.id !== id))
        setSelectedProduct(null)
      }}
      onAddToCart={addToCart}
    />
  )

  function closeForm() { stopBarcodeScanner(); setShowForm(false); setForm(EMPTY_FORM) }

  if (showForm) return (
    <div className="max-w-2xl mx-auto animate-slide-in-right">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={closeForm} className="text-slate-500 hover:text-slate-800 p-1 -ml-1">
          <ArrowLeft size={20} />
        </button>
        <h2 className="font-semibold text-slate-800">Neuer Artikel</h2>
      </header>
      <form onSubmit={handleCreate} className="p-4 space-y-4" style={{ paddingBottom: '60vh' }}>
        <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Barcode / QR-Code</label>
          <div className="flex gap-2">
            <input type="text" value={form.barcode}
              onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <button type="button" onClick={startBarcodeScanner} disabled={scanning}
              className="px-3 rounded-lg border border-slate-300 text-slate-500 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-600 disabled:opacity-40 transition-colors">
              <Camera size={16} />
            </button>
          </div>
          <div className={`relative bg-slate-900 rounded-xl overflow-hidden mt-2 ${scanning ? '' : 'h-0 mt-0 overflow-hidden'}`} style={{ minHeight: scanning ? 280 : 0 }}>
            <div id="barcode-scanner" className="w-full" />
            {scanning && (
              <button type="button" onClick={stopBarcodeScanner}
                className="absolute top-2 right-2 bg-black/40 text-white rounded-full p-1 z-10">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Kategorie *</label>
          <CategorySelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} categories={categories.filter(c => c !== 'all')} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Bestand" inputMode="numeric" value={form.current_stock} onChange={v => setForm(f => ({ ...f, current_stock: v }))} />
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
        <Field label="Lieferant / Hersteller" value={form.preferred_supplier} onChange={v => setForm(f => ({ ...f, preferred_supplier: v }))} />
        <Field label="Bestell-Website" type="url" value={form.supplier_url} onChange={v => setForm(f => ({ ...f, supplier_url: v }))} />
        <Field label="Notizen" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} rows={3} />
        <button type="submit" disabled={saving}
          className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm">
          {saving ? 'Speichern…' : 'Artikel hinzufügen'}
        </button>
      </form>
    </div>
  )

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto">
      {/* Summary filter bar */}
      <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-white sticky top-0 z-10">
        <button onClick={() => setFilter('all')} className={`py-2 px-4 text-center transition-colors ${filter === 'all' ? 'bg-sky-50' : ''}`}>
          <p className={`text-xl font-bold ${filter === 'all' ? 'text-sky-600' : 'text-slate-800'}`}>{products.length}</p>
          <p className={`text-xs mt-0.5 ${filter === 'all' ? 'text-sky-500 font-medium' : 'text-slate-500'}`}>Alle</p>
        </button>
        <button onClick={() => setFilter(filter === 'kritisch' ? 'all' : 'kritisch')} className={`py-2 px-4 text-center transition-colors ${filter === 'kritisch' ? 'bg-red-50' : ''}`}>
          <p className={`text-xl font-bold ${filter === 'kritisch' ? 'text-red-500' : kritischCount > 0 ? 'text-red-500' : 'text-slate-800'}`}>{kritischCount}</p>
          <p className={`text-xs mt-0.5 ${filter === 'kritisch' ? 'text-red-500 font-medium' : 'text-slate-500'}`}>Kritisch</p>
        </button>
        <button onClick={() => setFilter(filter === 'niedrig' ? 'all' : 'niedrig')} className={`py-2 px-4 text-center transition-colors ${filter === 'niedrig' ? 'bg-amber-50' : ''}`}>
          <p className={`text-xl font-bold ${filter === 'niedrig' ? 'text-amber-500' : niedrigCount > 0 ? 'text-amber-500' : 'text-slate-800'}`}>{niedrigCount}</p>
          <p className={`text-xs mt-0.5 ${filter === 'niedrig' ? 'text-amber-500 font-medium' : 'text-slate-500'}`}>Niedrig</p>
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Search + add */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Artikel suchen…"
              className="w-full border border-slate-300 rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={15} />
              </button>
            )}
          </div>
          <button onClick={() => setShowForm(true)} title="Artikel hinzufügen"
            className="bg-sky-500 hover:bg-sky-600 text-white px-3 rounded-xl transition-colors flex items-center">
            <Plus size={20} />
          </button>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedCategory === cat ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}>
              {cat === 'all' ? 'Alle' : cat}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-12">Keine Artikel gefunden</p>
        ) : (
          <div className="space-y-5">
            <ProductGroup label="Kritisch" color="bg-red-400" textColor="text-red-500" products={kritisch} onOpen={setSelectedProduct} addedToCart={addedToCart} onAddToCart={addToCart} />
            <ProductGroup label="Niedrig" color="bg-amber-400" textColor="text-amber-500" products={niedrig} onOpen={setSelectedProduct} addedToCart={addedToCart} onAddToCart={addToCart} />
            <ProductGroup label="Ausreichend" color="bg-emerald-400" textColor="text-emerald-600" products={ok} onOpen={setSelectedProduct} addedToCart={addedToCart} onAddToCart={addToCart} />
          </div>
        )}
      </div>

    </div>
  )
}

// ── Group section ──────────────────────────────────────────────────────────
function ProductGroup({ label, color, textColor, products, onOpen, addedToCart, onAddToCart }: {
  label: string; color: string; textColor: string
  products: Product[]; onOpen: (p: Product) => void
  addedToCart: Set<string>; onAddToCart: (id: string, quantity: number) => void
}) {
  if (products.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</h3>
        <span className={`text-xs font-semibold ${textColor}`}>{products.length}</span>
      </div>
      <div className="space-y-2">
        {products.map(p => (
          <ProductRow key={p.id} product={p} onOpen={() => onOpen(p)}
            added={addedToCart.has(p.id)} onAddToCart={(qty) => onAddToCart(p.id, qty)} />
        ))}
      </div>
    </div>
  )
}

// ── Product row ────────────────────────────────────────────────────────────
function ProductRow({ product: p, onOpen, added, onAddToCart }: {
  product: Product; onOpen: () => void; added: boolean; onAddToCart: (qty: number) => void
}) {
  const low = isLowStock(p)
  const near = isNearThreshold(p)
  const defaultQty = Math.max(1, Math.ceil(p.min_stock * 1.5))

  const max = Math.max(p.current_stock, p.min_stock * 2.5, 1)
  const fillPct = Math.min(100, (p.current_stock / max) * 100)
  const thresholdPct = Math.min(99, (p.min_stock / max) * 100)
  const barColor = low ? 'bg-red-400' : near ? 'bg-amber-400' : 'bg-emerald-400'
  const stockColor = low ? 'text-red-500' : near ? 'text-amber-500' : 'text-slate-800'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        {/* Tappable info area → navigate to detail */}
        <button onClick={onOpen} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {p.category}{p.preferred_supplier ? ` · ${p.preferred_supplier}` : ''}
          </p>
        </button>

        {/* Stock count → also navigates */}
        <button onClick={onOpen} className="text-right shrink-0">
          <span className={`text-2xl font-bold leading-none ${stockColor}`}>{p.current_stock}</span>
          <p className="text-xs text-slate-400 mt-0.5">{p.unit}</p>
        </button>

        {/* Add to cart with default qty */}
        <button
          onClick={e => { e.stopPropagation(); onAddToCart(defaultQty) }}
          className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-colors ${
            added ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 hover:bg-sky-100 hover:text-sky-600 text-slate-500'
          }`}
        >
          {added ? <Check size={16} /> : <ShoppingCart size={16} />}
        </button>
      </div>

      {/* Stock bar */}
      <div className="relative h-1.5 bg-slate-100">
        <div className={`absolute left-0 top-0 h-full transition-all ${barColor}`} style={{ width: `${fillPct}%` }} />
        <div className="absolute top-0 h-full w-[3px] bg-slate-500 opacity-60" style={{ left: `${thresholdPct}%` }} />
      </div>
    </div>
  )
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
