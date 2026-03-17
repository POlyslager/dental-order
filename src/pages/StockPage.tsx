import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product, Role } from '../lib/types'

interface Props { role: Role | null }

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
  article_number: '',
  name: '',
  category: '',
  current_stock: 0,
  min_stock: 1,
  unit: 'pcs',
  preferred_supplier: '',
  supplier_url: '',
  last_price: '',
  storage_location: '',
  expiry_date: '',
  notes: '',
  reorder_quantity: '',
}

export default function StockPage({ role: _role }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    fetchProducts()
  }, [])

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
      last_price: form.last_price ? parseFloat(form.last_price) : null,
      reorder_quantity: form.reorder_quantity ? parseFloat(form.reorder_quantity) : null,
      expiry_date: form.expiry_date || null,
      article_number: form.article_number || null,
      supplier_url: form.supplier_url || null,
      preferred_supplier: form.preferred_supplier || null,
      storage_location: form.storage_location || null,
      notes: form.notes || null,
    })
    setForm(EMPTY_FORM)
    setShowForm(false)
    setSaving(false)
    fetchProducts()
  }

  async function handleDelete(id: string) {
    await supabase.from('products').delete().eq('id', id)
    setDeleteConfirm(null)
    setProducts(prev => prev.filter(p => p.id !== id))
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
          <p className="text-xs text-slate-500 mt-0.5">Artikel gesamt</p>
        </div>
        <div className="py-3 px-4 text-center">
          <p className={`text-2xl font-bold ${lowCount > 0 ? 'text-amber-500' : 'text-slate-800'}`}>{lowCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Niedriger Bestand</p>
        </div>
        <div className="py-3 px-4 text-center">
          <p className={`text-2xl font-bold ${expiredCount > 0 ? 'text-red-500' : 'text-slate-800'}`}>{expiredCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Abgelaufen</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Search + view toggle + add button */}
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
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 flex items-center transition-colors ${viewMode === 'grid' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              title="Rasteransicht"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1"/>
                <rect x="9" y="1" width="6" height="6" rx="1"/>
                <rect x="1" y="9" width="6" height="6" rx="1"/>
                <rect x="9" y="9" width="6" height="6" rx="1"/>
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 flex items-center border-l border-slate-300 transition-colors ${viewMode === 'list' ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              title="Listenansicht"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="1"/>
                <rect x="1" y="7" width="14" height="2" rx="1"/>
                <rect x="1" y="12" width="14" height="2" rx="1"/>
              </svg>
            </button>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-sky-500 hover:bg-sky-600 text-white px-3 rounded-xl text-xl font-medium transition-colors"
            title="Artikel hinzufügen"
          >
            +
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {([
            { id: 'all', label: 'Alle' },
            { id: 'low', label: `Niedrig${lowCount > 0 ? ` (${lowCount})` : ''}` },
            { id: 'expired', label: `Abgelaufen${expiredCount > 0 ? ` (${expiredCount})` : ''}` },
          ] as { id: Filter; label: string }[]).map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f.id ? 'bg-sky-500 text-white' : 'bg-white border border-slate-300 text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Category scroll */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedCategory === cat ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              {cat === 'all' ? 'Alle Kategorien' : cat}
            </button>
          ))}
        </div>

        {/* Products */}
        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-12">Keine Artikel gefunden</p>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(p => (
              <ProductCard key={p.id} product={p} onDelete={() => setDeleteConfirm(p.id)} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => (
              <ProductRow key={p.id} product={p} onDelete={() => setDeleteConfirm(p.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold text-slate-800 mb-2">Artikel löschen?</h3>
            <p className="text-sm text-slate-500 mb-5">
              {products.find(p => p.id === deleteConfirm)?.name} wird dauerhaft gelöscht.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600"
              >
                Abbrechen
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add product modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h3 className="font-semibold text-slate-800">Neuer Artikel</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Artikelnummer" value={form.article_number} onChange={v => setForm(f => ({ ...f, article_number: v }))} />
                <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
              </div>
              <Field label="Kategorie *" value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} required />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Bestand" type="number" value={String(form.current_stock)} onChange={v => setForm(f => ({ ...f, current_stock: parseFloat(v) || 0 }))} />
                <Field label="Mindestbestand" type="number" value={String(form.min_stock)} onChange={v => setForm(f => ({ ...f, min_stock: parseFloat(v) || 0 }))} />
                <Field label="Einheit" value={form.unit} onChange={v => setForm(f => ({ ...f, unit: v }))} />
              </div>
              <Field label="Lagerort" value={form.storage_location} onChange={v => setForm(f => ({ ...f, storage_location: v }))} />
              <Field label="Ablaufdatum" type="date" value={form.expiry_date} onChange={v => setForm(f => ({ ...f, expiry_date: v }))} />
              <Field label="Lieferant" value={form.preferred_supplier} onChange={v => setForm(f => ({ ...f, preferred_supplier: v }))} />
              <Field label="Lieferant Website" type="url" value={form.supplier_url} onChange={v => setForm(f => ({ ...f, supplier_url: v }))} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stückpreis (€)" type="number" value={form.last_price} onChange={v => setForm(f => ({ ...f, last_price: v }))} />
                <Field label="Nachbestell-Menge" type="number" value={form.reorder_quantity} onChange={v => setForm(f => ({ ...f, reorder_quantity: v }))} />
              </div>
              <Field label="Notizen" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm transition-colors"
              >
                {saving ? 'Speichern…' : 'Artikel hinzufügen'}
              </button>
            </form>
          </div>
        </div>
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
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        step={type === 'number' ? 'any' : undefined}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  )
}

function ProductRow({ product: p, onDelete }: { product: Product; onDelete: () => void }) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  return (
    <div className={`bg-white rounded-xl px-4 py-3 border shadow-sm flex items-center gap-3 ${
      expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'
    }`}>
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
        expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
        <div className="flex gap-3 mt-0.5">
          <span className="text-xs text-slate-400">{p.category}</span>
          {p.storage_location && <span className="text-xs text-slate-400">📍 {p.storage_location}</span>}
          {p.expiry_date && (
            <span className={`text-xs ${expired ? 'text-red-500 font-medium' : expiringSoon ? 'text-orange-500' : 'text-slate-400'}`}>
              ⏳ {new Date(p.expiry_date).toLocaleDateString('de-DE')}
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-lg font-bold leading-none ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>{p.current_stock}</p>
        <p className="text-xs text-slate-400 mt-0.5">min {p.min_stock}</p>
      </div>
      {(low || expired) && p.supplier_url && (
        <a href={p.supplier_url} target="_blank" rel="noopener noreferrer"
          className="shrink-0 text-xs bg-sky-50 hover:bg-sky-100 text-sky-600 font-medium px-2.5 py-1.5 rounded-lg transition-colors">
          →
        </a>
      )}
      <button onClick={onDelete} className="shrink-0 text-slate-300 hover:text-red-400 transition-colors" title="Löschen">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 2a1 1 0 0 0-1 1v.5H2.5a.5.5 0 0 0 0 1H3v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8h.5a.5.5 0 0 0 0-1H11V3a1 1 0 0 0-1-1H6zm0 1h4v.5H6V3zm-2 2h8v8H4V5zm2 1.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5zm4 0a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5z"/>
        </svg>
      </button>
    </div>
  )
}

function ProductCard({ product: p, onDelete }: { product: Product; onDelete: () => void }) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  const stockPercent = p.min_stock > 0
    ? Math.min(100, Math.round((p.current_stock / (p.min_stock * 2)) * 100))
    : 100
  const barColor = expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <div className={`bg-white rounded-2xl p-4 border shadow-sm flex flex-col gap-2 ${
      expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium text-slate-400 truncate">{p.article_number}</span>
        <div className="flex items-center gap-1 shrink-0">
          {expired && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Abgelaufen</span>}
          {!expired && low && <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">Niedrig</span>}
          {!expired && !low && expiringSoon && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">Läuft ab</span>}
          <button onClick={onDelete} className="text-slate-300 hover:text-red-400 transition-colors ml-1" title="Löschen">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 2a1 1 0 0 0-1 1v.5H2.5a.5.5 0 0 0 0 1H3v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8h.5a.5.5 0 0 0 0-1H11V3a1 1 0 0 0-1-1H6zm0 1h4v.5H6V3zm-2 2h8v8H4V5zm2 1.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5zm4 0a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5z"/>
            </svg>
          </button>
        </div>
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
        {p.storage_location && <p className="text-xs text-slate-400 truncate">📍 {p.storage_location}</p>}
        {p.expiry_date && (
          <p className={`text-xs truncate ${expired ? 'text-red-500 font-medium' : expiringSoon ? 'text-orange-500' : 'text-slate-400'}`}>
            ⏳ {new Date(p.expiry_date).toLocaleDateString('de-DE')}
          </p>
        )}
        {p.preferred_supplier && <p className="text-xs text-slate-400 truncate">🏪 {p.preferred_supplier}</p>}
      </div>
      {(low || expired) && p.supplier_url && (
        <a href={p.supplier_url} target="_blank" rel="noopener noreferrer"
          className="mt-1 w-full text-center text-xs bg-sky-50 hover:bg-sky-100 text-sky-600 font-medium py-1.5 rounded-lg transition-colors">
          Nachbestellen →
        </a>
      )}
    </div>
  )
}
