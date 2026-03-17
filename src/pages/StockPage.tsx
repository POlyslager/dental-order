import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product, Role } from '../lib/types'
import ProductDetailModal from '../components/ProductDetailModal'
import Drawer from '../components/Drawer'
import CategorySelect from '../components/CategorySelect'
import { Search, LayoutGrid, List, Plus, X, ChevronDown, ChevronUp, ChevronRight, ExternalLink } from 'lucide-react'

interface Props { role: Role | null; initialBarcode?: string | null; onBarcodeConsumed?: () => void }

type Filter = 'all' | 'low' | 'expired'
type ViewMode = 'grid' | 'list'

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function isExpired(p: Product) { return p.expiry_date ? new Date(p.expiry_date) < TODAY : false }
function isExpiringSoon(p: Product) {
  if (!p.expiry_date) return false
  const diff = (new Date(p.expiry_date).getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 60
}
function isLowStock(p: Product) { return p.current_stock <= p.min_stock }

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
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  const filtered = products
    .filter(p => {
      const matchesSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase()) ||
        (p.article_number?.toLowerCase().includes(search.toLowerCase()) ?? false)
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory
      const matchesFilter = filter === 'all' ? true : filter === 'low' ? isLowStock(p) : isExpired(p)
      return matchesSearch && matchesCategory && matchesFilter
    })
    .sort((a, b) => {
      const priority = (p: Product) => isExpired(p) ? 0 : isLowStock(p) ? 1 : 2
      const pa = priority(a), pb = priority(b)
      if (pa !== pb) return pa - pb
      // Within same priority: least stock first
      return a.current_stock - b.current_stock
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
        <button onClick={() => setFilter('all')} className={`py-2 px-4 text-center transition-colors ${filter === 'all' ? 'bg-sky-50' : ''}`}>
          <p className={`text-xl font-bold ${filter === 'all' ? 'text-sky-600' : 'text-slate-800'}`}>{products.length}</p>
          <p className={`text-xs mt-0.5 ${filter === 'all' ? 'text-sky-500 font-medium' : 'text-slate-500'}`}>Gesamt</p>
        </button>
        <button onClick={() => setFilter(filter === 'low' ? 'all' : 'low')} className={`py-2 px-4 text-center transition-colors ${filter === 'low' ? 'bg-amber-50' : ''}`}>
          <p className={`text-xl font-bold ${filter === 'low' ? 'text-amber-500' : lowCount > 0 ? 'text-amber-500' : 'text-slate-800'}`}>{lowCount}</p>
          <p className={`text-xs mt-0.5 ${filter === 'low' ? 'text-amber-500 font-medium' : 'text-slate-500'}`}>Niedrig</p>
        </button>
        <button onClick={() => setFilter(filter === 'expired' ? 'all' : 'expired')} className={`py-2 px-4 text-center transition-colors ${filter === 'expired' ? 'bg-red-50' : ''}`}>
          <p className={`text-xl font-bold ${filter === 'expired' ? 'text-red-500' : expiredCount > 0 ? 'text-red-500' : 'text-slate-800'}`}>{expiredCount}</p>
          <p className={`text-xs mt-0.5 ${filter === 'expired' ? 'text-red-500 font-medium' : 'text-slate-500'}`}>Abgelaufen</p>
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Search + view toggle */}
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
          <div className="flex border border-slate-300 rounded-xl overflow-hidden bg-white">
            <button onClick={() => setViewMode('grid')} title="Raster"
              className={`px-3 flex items-center transition-colors ${viewMode === 'grid' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <LayoutGrid size={15} />
            </button>
            <button onClick={() => setViewMode('list')} title="Liste"
              className={`px-3 flex items-center border-l border-slate-300 transition-colors ${viewMode === 'list' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <List size={15} />
            </button>
          </div>
          <button onClick={() => setShowForm(true)} title="Artikel hinzufügen"
            className="bg-sky-500 hover:bg-sky-600 text-white px-3 rounded-xl transition-colors flex items-center">
            <Plus size={20} />
          </button>
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
          <div className="space-y-1.5">
            {filtered.map(p => (
              <ExpandableRow
                key={p.id}
                product={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onOpen={() => setSelectedProduct(p)}
              />
            ))}
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

// ── Expandable list row (D) ────────────────────────────────────────────────
function ExpandableRow({ product: p, expanded, onToggle, onOpen }: {
  product: Product; expanded: boolean; onToggle: () => void; onOpen: () => void
}) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  const dot = expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'
  const border = expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${border}`}>
      {/* Collapsed row */}
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
          <p className="text-xs text-slate-400 truncate mt-0.5">{p.category}{p.storage_location ? ` · ${p.storage_location}` : ''}</p>
        </div>
        <div className="text-right shrink-0 mr-2">
          <p className={`text-base font-bold leading-none ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>{p.current_stock}</p>
          <p className="text-xs text-slate-400">min {p.min_stock}</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/50">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {p.unit && <Detail label="Einheit" value={p.unit} />}
            {p.last_price != null && <Detail label="Stückpreis" value={`€ ${p.last_price}`} />}
            {p.reorder_quantity != null && <Detail label="Nachbestellmenge" value={String(p.reorder_quantity)} />}
            {p.expiry_date && (
              <Detail
                label="Ablaufdatum"
                value={new Date(p.expiry_date).toLocaleDateString('de-DE')}
                alert={expired ? 'red' : expiringSoon ? 'orange' : undefined}
              />
            )}
            {p.preferred_supplier && <Detail label="Lieferant" value={p.preferred_supplier} />}
            {p.article_number && <Detail label="Artikelnr." value={p.article_number} />}
          </div>
          {p.notes && <p className="text-xs text-slate-500 italic">{p.notes}</p>}
          <div className="flex gap-2 pt-1">
            {p.supplier_url && (
              <a href={p.supplier_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-sky-600 font-medium border border-sky-200 rounded-lg px-3 py-1.5 hover:bg-sky-50">
                Bestellen <ExternalLink size={11} />
              </a>
            )}
            <button onClick={onOpen}
              className="flex items-center gap-1.5 text-xs text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-100 ml-auto">
              Details <ChevronRight size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, alert }: { label: string; value: string; alert?: 'red' | 'orange' }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-sm font-medium ${alert === 'red' ? 'text-red-500' : alert === 'orange' ? 'text-orange-500' : 'text-slate-700'}`}>{value}</p>
    </div>
  )
}

// ── Grid card ──────────────────────────────────────────────────────────────
function ProductCard({ product: p, onClick }: { product: Product; onClick: () => void }) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  // Scale: max is the larger of current stock or 2.5× the reorder threshold
  // so the threshold marker sits at a consistent ~40% position when stock = min
  const max = Math.max(p.current_stock, p.min_stock * 2.5, 1)
  const fillPct = Math.min(100, (p.current_stock / max) * 100)
  const thresholdPct = Math.min(99, (p.min_stock / max) * 100)
  const barColor = expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <div onClick={onClick} className={`bg-white rounded-2xl border shadow-sm flex flex-col cursor-pointer active:scale-[0.98] transition-transform overflow-hidden ${
      expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'
    }`}>
      {/* Card content */}
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-1">
          <span className="text-xs font-medium text-slate-400 truncate">{p.article_number}</span>
          {expired && <span className="shrink-0 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Abgelaufen</span>}
          {!expired && low && <span className="shrink-0 text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">Niedrig</span>}
          {!expired && !low && expiringSoon && <span className="shrink-0 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">Läuft ab</span>}
        </div>
        <p className="font-semibold text-slate-800 text-sm leading-snug line-clamp-2">{p.name}</p>
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>{p.current_stock}</span>
          <span className="text-xs text-slate-400">min {p.min_stock}</span>
        </div>
        <div className="space-y-1">
          {p.storage_location && <p className="text-xs text-slate-400 truncate">{p.storage_location}</p>}
          {p.expiry_date && (
            <p className={`text-xs truncate ${expired ? 'text-red-500 font-medium' : expiringSoon ? 'text-orange-500' : 'text-slate-400'}`}>
              Exp. {new Date(p.expiry_date).toLocaleDateString('de-DE')}
            </p>
          )}
          {p.preferred_supplier && <p className="text-xs text-slate-400 truncate">{p.preferred_supplier}</p>}
        </div>
      </div>

      {/* Full-width stock bar at bottom */}
      <div className="relative h-2 bg-slate-100 mt-auto">
        <div className={`absolute left-0 top-0 h-full transition-all ${barColor}`} style={{ width: `${fillPct}%` }} />
        {/* Reorder threshold marker */}
        <div className="absolute top-0 h-full w-[2px] bg-slate-400" style={{ left: `${thresholdPct}%` }} />
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
