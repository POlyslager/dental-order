import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product, Role } from '../lib/types'

interface Props { role: Role | null }

export default function StockPage({ role }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

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

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  )

  const lowStock = filtered.filter(p => p.current_stock <= p.min_stock)
  const okStock = filtered.filter(p => p.current_stock > p.min_stock)

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search products…"
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      />

      {lowStock.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-1">
            <span>⚠️</span> Low Stock ({lowStock.length})
          </h2>
          <div className="space-y-2">
            {lowStock.map(p => <ProductCard key={p.id} product={p} role={role} />)}
          </div>
        </section>
      )}

      {okStock.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-600 mb-2">All Products ({okStock.length})</h2>
          <div className="space-y-2">
            {okStock.map(p => <ProductCard key={p.id} product={p} role={role} />)}
          </div>
        </section>
      )}

      {filtered.length === 0 && (
        <p className="text-center text-slate-400 py-12">No products found</p>
      )}
    </div>
  )
}

function ProductCard({ product: p }: { product: Product; role: Role | null }) {
  const isLow = p.current_stock <= p.min_stock

  return (
    <div className={`bg-white rounded-xl p-4 border ${isLow ? 'border-red-200' : 'border-slate-200'} shadow-sm`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-800 truncate">{p.name}</p>
          <p className="text-xs text-slate-500">{p.category}</p>
        </div>
        <div className={`text-right shrink-0 ${isLow ? 'text-red-600' : 'text-slate-700'}`}>
          <p className="font-semibold text-lg leading-none">{p.current_stock}</p>
          <p className="text-xs text-slate-400">min {p.min_stock} {p.unit}</p>
        </div>
      </div>
      {isLow && (
        <div className="mt-3 pt-3 border-t border-red-100 flex items-center justify-between">
          <span className="text-xs text-red-500">Needs reorder</span>
          {p.supplier_url && (
            <a href={p.supplier_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-sky-600 hover:underline">
              View supplier →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
