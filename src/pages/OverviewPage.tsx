import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { Euro, Package, ShoppingCart, Activity, TrendingUp } from 'lucide-react'

const TODAY = new Date()
const THIRTY_DAYS_AGO = new Date(TODAY.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

type MovementRow = { product_id: string; quantity: number; type: string; created_at: string; products: { name: string } | null }
type OrderRow = { id: string; status: string; created_at: string }

export default function OverviewPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [recentMovements, setRecentMovements] = useState<MovementRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('products').select('*'),
      supabase.from('stock_movements').select('product_id, quantity, type, created_at, products(name)'),
      supabase.from('stock_movements').select('product_id, quantity, type, created_at, products(name)')
        .gte('created_at', THIRTY_DAYS_AGO),
      supabase.from('orders').select('id, status, created_at'),
    ]).then(([{ data: p }, { data: m }, { data: rm }, { data: o }]) => {
      setProducts(p ?? [])
      setMovements((m as unknown as MovementRow[]) ?? [])
      setRecentMovements((rm as unknown as MovementRow[]) ?? [])
      setOrders(o ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // KPIs
  const totalValue = products.reduce((sum, p) => sum + (p.current_stock * (p.last_price ?? 0)), 0)
  const ordersThisMonth = orders.filter(o => o.created_at >= THIRTY_DAYS_AGO).length
  const movementsThisMonth = recentMovements.length
  const stockHealth = {
    green: products.filter(p => p.current_stock > p.min_stock * 1.5).length,
    orange: products.filter(p => p.current_stock > p.min_stock && p.current_stock <= p.min_stock * 1.5).length,
    red: products.filter(p => p.current_stock <= p.min_stock).length,
  }

  // Top 10 most used products (scan_out movements all time)
  const usageCounts: Record<string, { name: string; count: number; quantity: number }> = {}
  movements
    .filter(m => m.type === 'scan_out' || m.type === 'manual_out')
    .forEach(m => {
      const name = m.products?.name ?? m.product_id
      if (!usageCounts[m.product_id]) usageCounts[m.product_id] = { name, count: 0, quantity: 0 }
      usageCounts[m.product_id].count++
      usageCounts[m.product_id].quantity += m.quantity
    })
  const topProducts = Object.entries(usageCounts)
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 10)

  // Monthly activity (last 6 months)
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - (5 - i), 1)
    const end = new Date(TODAY.getFullYear(), TODAY.getMonth() - (5 - i) + 1, 1)
    const count = movements.filter(m => {
      const t = new Date(m.created_at)
      return t >= d && t < end
    }).length
    return {
      label: d.toLocaleDateString('de-DE', { month: 'short' }),
      count,
    }
  })
  const maxMonthly = Math.max(...monthlyData.map(d => d.count), 1)

  // Order status breakdown
  const orderStatuses = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1
    return acc
  }, {})

  const STATUS_LABELS: Record<string, string> = {
    draft: 'Entwurf', pending_approval: 'Ausstehend', approved: 'Genehmigt',
    ordered: 'Bestellt', received: 'Erhalten', cancelled: 'Abgebrochen',
  }
  const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-slate-200', pending_approval: 'bg-amber-400',
    approved: 'bg-emerald-400', ordered: 'bg-sky-400',
    received: 'bg-emerald-600', cancelled: 'bg-red-300',
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6 pb-8">

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={<Euro size={18} className="text-sky-600" />} bg="bg-sky-50"
          label="Lagerwert"
          value={`€ ${totalValue.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`} />
        <KpiCard icon={<Package size={18} className="text-slate-500" />} bg="bg-slate-50"
          label="Artikel gesamt"
          value={String(products.length)} />
        <KpiCard icon={<ShoppingCart size={18} className="text-violet-500" />} bg="bg-violet-50"
          label="Bestellungen (30 Tage)"
          value={String(ordersThisMonth)} />
        <KpiCard icon={<Activity size={18} className="text-emerald-500" />} bg="bg-emerald-50"
          label="Lagerbewegungen (30 Tage)"
          value={String(movementsThisMonth)} />
      </div>

      {/* Stock health */}
      <Section title="Lagergesundheit">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
            {stockHealth.green > 0 && (
              <div className="bg-emerald-400 rounded-full" style={{ flex: stockHealth.green }} />
            )}
            {stockHealth.orange > 0 && (
              <div className="bg-amber-400 rounded-full" style={{ flex: stockHealth.orange }} />
            )}
            {stockHealth.red > 0 && (
              <div className="bg-red-400 rounded-full" style={{ flex: stockHealth.red }} />
            )}
          </div>
          <div className="grid grid-cols-3 text-center">
            <div>
              <p className="text-lg font-bold text-emerald-600">{stockHealth.green}</p>
              <p className="text-xs text-slate-400">Ausreichend</p>
            </div>
            <div>
              <p className="text-lg font-bold text-amber-500">{stockHealth.orange}</p>
              <p className="text-xs text-slate-400">Niedrig</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-500">{stockHealth.red}</p>
              <p className="text-xs text-slate-400">Kritisch</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Monthly activity */}
      <Section title="Monatliche Aktivität">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-end gap-2 h-24">
            {monthlyData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-sky-100 rounded-t-md relative" style={{ height: `${Math.max(4, (d.count / maxMonthly) * 80)}px` }}>
                  <div className="absolute inset-0 bg-sky-400 rounded-t-md" />
                </div>
                <span className="text-xs text-slate-400">{d.label}</span>
              </div>
            ))}
          </div>
          {movements.length === 0 && (
            <p className="text-xs text-slate-400 text-center mt-2">Noch keine Bewegungen erfasst</p>
          )}
        </div>
      </Section>

      {/* Top 10 most used */}
      <Section title="Top 10 meistverbrauchte Artikel" icon={<TrendingUp size={15} className="text-slate-400" />}>
        {topProducts.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6 bg-white rounded-2xl border border-slate-100">
            Noch keine Scanbewegungen vorhanden
          </p>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
            {topProducts.map(([, data], i) => {
              const maxQty = topProducts[0][1].quantity
              return (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-slate-300 w-5 shrink-0">#{i + 1}</span>
                      <p className="text-sm text-slate-700 truncate">{data.name}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-800 shrink-0 ml-2">{data.quantity}×</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden ml-7">
                    <div className="h-full bg-sky-400 rounded-full" style={{ width: `${(data.quantity / maxQty) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Order status breakdown */}
      {orders.length > 0 && (
        <Section title="Bestellungen nach Status">
          <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
            {Object.entries(orderStatuses).map(([status, count]) => (
              <div key={status} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLORS[status] ?? 'bg-slate-300'}`} />
                <p className="text-sm text-slate-700 flex-1">{STATUS_LABELS[status] ?? status}</p>
                <span className="text-sm font-semibold text-slate-800">{count}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

    </div>
  )
}

function KpiCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <div className={`${bg} rounded-2xl p-4`}>
      <div className="mb-2">{icon}</div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</h3>
      </div>
      {children}
    </div>
  )
}
