import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product, StockMovement } from '../lib/types'
import {
  Euro, Package, AlertTriangle, CalendarX, TrendingDown,
  Clock, ExternalLink, ChevronRight,
} from 'lucide-react'

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24))
}

export default function OverviewPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<(StockMovement & { product: { name: string } })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('products').select('*'),
      supabase
        .from('stock_movements')
        .select('*, product:products(name)')
        .order('created_at', { ascending: false })
        .limit(8),
    ]).then(([{ data: p }, { data: m }]) => {
      setProducts(p ?? [])
      setMovements((m ?? []) as (StockMovement & { product: { name: string } })[])
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const totalValue = products.reduce((sum, p) => sum + (p.current_stock * (p.last_price ?? 0)), 0)
  const reorderList = products.filter(p => p.current_stock <= p.min_stock).sort((a, b) => a.current_stock - b.current_stock)
  const expiringSoon = products
    .filter(p => p.expiry_date && daysUntil(p.expiry_date) <= 60 && daysUntil(p.expiry_date) >= 0)
    .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
  const expired = products.filter(p => p.expiry_date && daysUntil(p.expiry_date) < 0)

  const categories = Array.from(new Set(products.map(p => p.category))).sort()
  const maxCatCount = Math.max(...categories.map(c => products.filter(p => p.category === c).length), 1)

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6 pb-8">

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          icon={<Euro size={18} className="text-sky-600" />}
          label="Lagerwert"
          value={`€ ${totalValue.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          bg="bg-sky-50"
        />
        <KpiCard
          icon={<Package size={18} className="text-slate-600" />}
          label="Artikel gesamt"
          value={String(products.length)}
          bg="bg-slate-50"
        />
        <KpiCard
          icon={<TrendingDown size={18} className="text-amber-500" />}
          label="Nachbestellen"
          value={String(reorderList.length)}
          bg="bg-amber-50"
          alert={reorderList.length > 0}
        />
        <KpiCard
          icon={<CalendarX size={18} className="text-red-500" />}
          label="Abgelaufen"
          value={String(expired.length)}
          bg="bg-red-50"
          alert={expired.length > 0}
        />
      </div>

      {/* Reorder list */}
      {reorderList.length > 0 && (
        <Section icon={<AlertTriangle size={16} className="text-amber-500" />} title="Nachbestellen">
          <div className="space-y-2">
            {reorderList.map(p => (
              <div key={p.id} className="bg-white rounded-xl border border-amber-100 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Bestand: <span className="text-red-500 font-semibold">{p.current_stock}</span> / min {p.min_stock} {p.unit}
                    {p.preferred_supplier && <span className="ml-2">· {p.preferred_supplier}</span>}
                  </p>
                </div>
                {p.supplier_url ? (
                  <a href={p.supplier_url} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 text-sky-600 hover:text-sky-800 flex items-center gap-1 text-xs font-medium">
                    Bestellen <ExternalLink size={12} />
                  </a>
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-slate-300" />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Expiring soon */}
      {expiringSoon.length > 0 && (
        <Section icon={<CalendarX size={16} className="text-orange-500" />} title="Läuft bald ab (≤ 60 Tage)">
          <div className="space-y-2">
            {expiringSoon.map(p => {
              const days = daysUntil(p.expiry_date!)
              return (
                <div key={p.id} className="bg-white rounded-xl border border-orange-100 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{p.storage_location ?? '—'} · {p.current_stock} {p.unit}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${
                    days <= 14 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    {days}d
                  </span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Recent activity */}
      {movements.length > 0 && (
        <Section icon={<Clock size={16} className="text-slate-500" />} title="Letzte Aktivität">
          <div className="space-y-1">
            {movements.map(m => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-slate-100">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  m.type === 'scan_in' || m.type === 'manual_in'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {m.type === 'scan_in' || m.type === 'manual_in' ? `+${m.quantity}` : `-${m.quantity}`}
                </span>
                <p className="text-sm text-slate-700 flex-1 truncate">{m.product?.name ?? '—'}</p>
                <p className="text-xs text-slate-400 shrink-0">
                  {new Date(m.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Category breakdown */}
      <Section icon={<Package size={16} className="text-slate-500" />} title="Kategorien">
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
          {categories.map(cat => {
            const count = products.filter(p => p.category === cat).length
            const lowInCat = products.filter(p => p.category === cat && p.current_stock <= p.min_stock).length
            return (
              <div key={cat} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm text-slate-700 truncate">{cat}</p>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {lowInCat > 0 && (
                      <span className="text-xs text-amber-600 font-medium">{lowInCat} niedrig</span>
                    )}
                    <span className="text-xs text-slate-400">{count}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 rounded-full"
                    style={{ width: `${(count / maxCatCount) * 100}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

function KpiCard({ icon, label, value, bg, alert = false }: {
  icon: React.ReactNode; label: string; value: string; bg: string; alert?: boolean
}) {
  return (
    <div className={`${bg} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <p className={`text-2xl font-bold ${alert ? 'text-red-500' : 'text-slate-800'}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">{title}</h3>
      </div>
      {children}
    </div>
  )
}
