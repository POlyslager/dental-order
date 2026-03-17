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

export default function StockPage({ role: _role }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  useEffect(() => {
    supabase
      .from('products')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setProducts(data ?? [])
        setLoading(false)
      })
  }, [])

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
                filter === f.id
                  ? 'bg-sky-500 text-white'
                  : 'bg-white border border-slate-300 text-slate-600'
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
                selectedCategory === cat
                  ? 'bg-slate-800 text-white'
                  : 'bg-white border border-slate-200 text-slate-600'
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
            {filtered.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => <ProductRow key={p.id} product={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function ProductRow({ product: p }: { product: Product }) {
  const low = isLowStock(p)
  const expired = isExpired(p)
  const expiringSoon = isExpiringSoon(p)

  return (
    <div className={`bg-white rounded-xl px-4 py-3 border shadow-sm flex items-center gap-3 ${
      expired ? 'border-red-200' : low ? 'border-amber-200' : 'border-slate-200'
    }`}>
      {/* Stock indicator dot */}
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
        expired || low ? 'bg-red-400' : expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'
      }`} />

      {/* Name + meta */}
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

      {/* Stock + badge */}
      <div className="text-right shrink-0">
        <p className={`text-lg font-bold leading-none ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>
          {p.current_stock}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">min {p.min_stock}</p>
      </div>

      {/* Reorder link */}
      {(low || expired) && p.supplier_url && (
        <a
          href={p.supplier_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs bg-sky-50 hover:bg-sky-100 text-sky-600 font-medium px-2.5 py-1.5 rounded-lg transition-colors"
        >
          →
        </a>
      )}
    </div>
  )
}

function ProductCard({ product: p }: { product: Product }) {
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
      {/* Status badge */}
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium text-slate-400 truncate">{p.article_number}</span>
        {expired && <span className="shrink-0 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Abgelaufen</span>}
        {!expired && low && <span className="shrink-0 text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">Niedrig</span>}
        {!expired && !low && expiringSoon && <span className="shrink-0 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">Läuft ab</span>}
      </div>

      {/* Name */}
      <p className="font-semibold text-slate-800 text-sm leading-snug line-clamp-2">{p.name}</p>

      {/* Stock level */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-2xl font-bold ${low || expired ? 'text-red-500' : 'text-slate-800'}`}>
            {p.current_stock}
          </span>
          <span className="text-xs text-slate-400">min {p.min_stock}</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${stockPercent}%` }} />
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1 mt-1">
        {p.storage_location && (
          <p className="text-xs text-slate-400 truncate">📍 {p.storage_location}</p>
        )}
        {p.expiry_date && (
          <p className={`text-xs truncate ${expired ? 'text-red-500 font-medium' : expiringSoon ? 'text-orange-500' : 'text-slate-400'}`}>
            ⏳ {new Date(p.expiry_date).toLocaleDateString('de-DE')}
          </p>
        )}
        {p.preferred_supplier && (
          <p className="text-xs text-slate-400 truncate">🏪 {p.preferred_supplier}</p>
        )}
      </div>

      {/* Reorder link */}
      {(low || expired) && p.supplier_url && (
        <a
          href={p.supplier_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 w-full text-center text-xs bg-sky-50 hover:bg-sky-100 text-sky-600 font-medium py-1.5 rounded-lg transition-colors"
        >
          Nachbestellen →
        </a>
      )}
    </div>
  )
}
