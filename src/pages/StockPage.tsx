import { useEffect, useState } from 'react'
import { supabase, getCurrentUser } from '../lib/supabase'
import type { Product, Role } from '../lib/types'
import ProductDetailModal from '../components/ProductDetailModal'
import Drawer from '../components/Drawer'
import CategorySelect from '../components/CategorySelect'
import { Search, Plus, X, ShoppingCart, Check } from 'lucide-react'

interface Props { role: Role | null; initialBarcode?: string | null; onBarcodeConsumed?: () => void }

type Filter = 'all' | 'kritisch' | 'niedrig'

function isLowStock(p: Product) { return p.current_stock <= p.min_stock }
function isNearThreshold(p: Product) { return !isLowStock(p) && p.current_stock <= p.min_stock * 1.5 }

const EMPTY_FORM = {
  article_number: '', name: '', description: '', category: '', barcode: '',
  min_stock: 1, unit: 'pcs', preferred_supplier: '', supplier_url: '',
  producer_url: '', last_price: '', storage_location: '', notes: '', reorder_quantity: '',
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

  async function addToCart(productId: string, reorderQty: number | null) {
    const user = await getCurrentUser()
    if (!user) return
    const qty = reorderQty ?? 1
    const { data: existing } = await supabase
      .from('cart_items').select('id, quantity').eq('product_id', productId).maybeSingle()
    if (existing) {
      await supabase.from('cart_items').update({ quantity: existing.quantity + qty }).eq('id', existing.id)
    } else {
      await supabase.from('cart_items').insert({ product_id: productId, quantity: qty, added_by: user.id })
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
      current_stock: 0,
      last_price: form.last_price ? parseFloat(form.last_price) : null,
      reorder_quantity: form.reorder_quantity ? parseFloat(form.reorder_quantity) : null,
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

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto">
      {/* Summary filter bar */}
      <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-white sticky top-14 z-10">
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

      {/* Add product drawer */}
      <Drawer open={showForm} onClose={() => { setShowForm(false); setForm(EMPTY_FORM) }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800">Neuer Artikel</h3>
          <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleCreate} className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
            <p className="text-xs text-sky-700">Der Bestand wird automatisch über das Scannen aktualisiert.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Artikelnummer" value={form.article_number} onChange={v => setForm(f => ({ ...f, article_number: v }))} />
            <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
          </div>
          <Field label="Barcode / QR-Code" value={form.barcode} onChange={v => setForm(f => ({ ...f, barcode: v }))} />
          <Field label="Beschreibung" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Kategorie *</label>
            <CategorySelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} categories={categories.filter(c => c !== 'all')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meldebestand *" type="number" value={String(form.min_stock)} onChange={v => setForm(f => ({ ...f, min_stock: parseFloat(v) || 0 }))} required />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
              <CategorySelect value={form.unit} onChange={v => setForm(f => ({ ...f, unit: v }))} categories={UNITS} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lagerort</label>
            <select value={form.storage_location} onChange={e => setForm(f => ({ ...f, storage_location: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">— Kein Lagerort —</option>
              {STORAGE_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <Field label="Lieferant" value={form.preferred_supplier} onChange={v => setForm(f => ({ ...f, preferred_supplier: v }))} />
          <Field label="Bestell-Website" type="url" value={form.supplier_url} onChange={v => setForm(f => ({ ...f, supplier_url: v }))} />
          <Field label="Hersteller-Website" type="url" value={form.producer_url} onChange={v => setForm(f => ({ ...f, producer_url: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stückpreis (€)" type="number" value={form.last_price} onChange={v => setForm(f => ({ ...f, last_price: v }))} />
            <Field label="Nachbestellmenge" type="number" value={form.reorder_quantity} onChange={v => setForm(f => ({ ...f, reorder_quantity: v }))} />
          </div>
          <Field label="Notizen" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />
          <button type="submit" disabled={saving}
            className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm">
            {saving ? 'Speichern…' : 'Artikel hinzufügen'}
          </button>
        </form>
      </Drawer>

      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onUpdated={updated => {
            setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
            setSelectedProduct(updated)
          }}
          onDeleted={id => {
            setProducts(prev => prev.filter(p => p.id !== id))
            setSelectedProduct(null)
          }}
        />
      )}
    </div>
  )
}

// ── Group section ──────────────────────────────────────────────────────────
function ProductGroup({ label, color, textColor, products, onOpen, addedToCart, onAddToCart }: {
  label: string; color: string; textColor: string
  products: Product[]; onOpen: (p: Product) => void
  addedToCart: Set<string>; onAddToCart: (id: string, qty: number | null) => void
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
            added={addedToCart.has(p.id)} onAddToCart={() => onAddToCart(p.id, p.reorder_quantity)} />
        ))}
      </div>
    </div>
  )
}

// ── Product row ────────────────────────────────────────────────────────────
function ProductRow({ product: p, onOpen, added, onAddToCart }: {
  product: Product; onOpen: () => void; added: boolean; onAddToCart: () => void
}) {
  const low = isLowStock(p)
  const near = isNearThreshold(p)

  const max = Math.max(p.current_stock, p.min_stock * 2.5, 1)
  const fillPct = Math.min(100, (p.current_stock / max) * 100)
  const thresholdPct = Math.min(99, (p.min_stock / max) * 100)
  const barColor = low ? 'bg-red-400' : near ? 'bg-amber-400' : 'bg-emerald-400'
  const stockColor = low ? 'text-red-500' : near ? 'text-amber-500' : 'text-slate-800'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        {/* Info */}
        <button onClick={onOpen} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {p.category}{p.preferred_supplier ? ` · ${p.preferred_supplier}` : ''}
          </p>
        </button>

        {/* Stock count */}
        <button onClick={onOpen} className="text-right shrink-0">
          <span className={`text-2xl font-bold leading-none ${stockColor}`}>{p.current_stock}</span>
          <p className="text-xs text-slate-400 mt-0.5">{p.unit}</p>
        </button>

        {/* Add to cart */}
        <button
          onClick={e => { e.stopPropagation(); onAddToCart() }}
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

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        step={type === 'number' ? 'any' : undefined}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
    </div>
  )
}
