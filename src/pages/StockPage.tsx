import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product, Role } from '../lib/types'
import ProductDetailModal from '../components/ProductDetailModal'
import Drawer from '../components/Drawer'

interface Props { role: Role | null; initialBarcode?: string | null; onBarcodeConsumed?: () => void }

type Filter = 'all' | 'low' | 'expired'
type ViewMode = 'grid' | 'list'

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function isExpired(p: Product) {
  return p.expiry_date ? new Date(p.expiry_date) < TODAY : false
}
function isExpiringSoon(p: Product) {
  if (!p.expiry_date) return false
  const exp = new Date(p.expiry_date)
  const diff = (exp.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 60
}
function isLowStock(p: Product) {
  return p.current_stock <= p.min_stock
}

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

export default function StockPage({ role: _role, initialBarcode, onBarcodeConsumed }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

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

  const filtered = products.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()) ||
      (p.article_number?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchesFilter =
      filter === 'all' ? true :
      filter === 'low' ? isLowStock(p) :
      filter === 'expired' ? isExpired(p) : true
    return matchesSearch && matchesCategory && matchesFilter
  })

  const lowCount = products.filter(isLowStock).length
  const expiredCount = products.filter(isExpired).length

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto">
      {/* Summary bar */}
      <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-white">
        <div className="py-3 px-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{products.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Gesamt</p>
        </div>
        <div className="py-3 px-4 text-center">
          <p className={`text-2xl font-bold ${lowCount > 0 ? 'text-amber-500' : 'text-slate-800'}`}>{lowCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Niedrig</p>
        </div>
        <div className="py-3 px-4 text-center">
          <p className={`text-2xl font-bold ${expiredCount > 0 ? 'text-red-500' : 'text-slate-800'}`}>{expiredCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Abgelaufen</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Search + view toggle */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Artikel suchen…"
              className="w-full border border-slate-300 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            />
          </div>
          <div className="flex border border-slate-300 rounded-xl overflow-hidden bg-white">
            <button onClick={() => setViewMode('grid')}
              className={`px-3 flex items-center transition-colors ${viewMode === 'grid' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              title="Rasteransicht">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
              </svg>
            </button>
            <button onClick={() => setViewMode('list')}
              className={`px-3 flex items-center border-l border-slate-300 transition-colors ${viewMode === 'list' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              title="Listenansicht">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/>
                <rect x="1" y="12" width="14" height="2" rx="1"/>
              </svg>
            </button>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-sky-500 hover:bg-sky-600 text-white px-3 rounded-xl text-xl font-medium transition-colors"
            title="Artikel hinzufügen"
          >+</button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {([
            { id: 'all',     label: 'Alle' },
            { id: 'low',     label: `Niedrig${lowCount > 0 ? ` (${lowCount})` : ''}` },
            { id: 'expired', label: `Abgelaufen${expiredCount > 0 ? ` (${expiredCount})` : ''}` },
          ] as { id: Filter; label: string }[]).map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f.id ? 'bg-sky-500 text-white' : 'bg-white border border-slate-300 text-slate-600'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Category scroll */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedCategory === cat ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}>
              {cat === 'all' ? 'Alle Kategorien' : cat}
            </button>
          ))}
        </div>

        {/* Products */}
        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-12">Keine Artikel gefunden</p>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(p => <ProductCard key={p.id} product={p} onClick={() => setSelectedProduct(p)} />)}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => <ProductRow key={p.id} product={p} onClick={() => setSelectedProduct(p)} />)}
          </div>
        )}
      </div>

      <Drawer open={showForm} onClose={() => { setShowForm(false); setForm(EMPTY_FORM) }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800">Neuer Artikel</h3>
          <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
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
          <Field label="Kategorie *" value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meldebestand *" type="number" value={String(form.min_stock)} onChange={v => setForm(f => ({ ...f, min_stock: parseFloat(v) || 0 }))} required />
            <Field label="Einheit" value={form.unit} onChange={v => setForm(f => ({ ...f, unit: v }))} />
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

function ProductRow({ product: p, onClick }: { product: Product; onClick: () => void }) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  return (
    <div onClick={onClick} className={`bg-white rounded-xl px-4 py-3 border shadow-sm flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-transform ${
      expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'
    }`}>
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
        expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
        <div className="flex gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-slate-400">{p.category}</span>
          {p.storage_location && <span className="text-xs text-slate-400">· {p.storage_location}</span>}
          {p.expiry_date && (
            <span className={`text-xs ${expired ? 'text-red-500 font-medium' : expiringSoon ? 'text-orange-500' : 'text-slate-400'}`}>
              · {new Date(p.expiry_date).toLocaleDateString('de-DE')}
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-lg font-bold leading-none ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>{p.current_stock}</p>
        <p className="text-xs text-slate-400 mt-0.5">min {p.min_stock}</p>
      </div>
    </div>
  )
}

function ProductCard({ product: p, onClick }: { product: Product; onClick: () => void }) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  const stockPercent = p.min_stock > 0
    ? Math.min(100, Math.round((p.current_stock / (p.min_stock * 2)) * 100))
    : 100
  const barColor = expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <div onClick={onClick} className={`bg-white rounded-2xl p-4 border shadow-sm flex flex-col gap-2 cursor-pointer active:scale-[0.98] transition-transform ${
      expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium text-slate-400 truncate">{p.article_number}</span>
        {expired && <span className="shrink-0 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Abgelaufen</span>}
        {!expired && low && <span className="shrink-0 text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">Niedrig</span>}
        {!expired && !low && expiringSoon && <span className="shrink-0 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">Läuft ab</span>}
      </div>
      <p className="font-semibold text-slate-800 text-sm leading-snug line-clamp-2">{p.name}</p>
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-2xl font-bold ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>{p.current_stock}</span>
          <span className="text-xs text-slate-400">min {p.min_stock}</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${stockPercent}%` }} />
        </div>
      </div>
      <div className="space-y-1 mt-1">
        {p.storage_location && <p className="text-xs text-slate-400 truncate">{p.storage_location}</p>}
        {p.expiry_date && (
          <p className={`text-xs truncate ${expired ? 'text-red-500 font-medium' : expiringSoon ? 'text-orange-500' : 'text-slate-400'}`}>
            Exp. {new Date(p.expiry_date).toLocaleDateString('de-DE')}
          </p>
        )}
        {p.preferred_supplier && <p className="text-xs text-slate-400 truncate">{p.preferred_supplier}</p>}
      </div>
    </div>
  )
}
