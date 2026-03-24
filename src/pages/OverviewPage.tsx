import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { Euro, Package, ShoppingCart, Activity, TrendingUp } from 'lucide-react'

type ProductKpi = Pick<Product, 'id' | 'current_stock' | 'min_stock' | 'last_price'>
type MovementRow = { product_id: string; quantity: number; type: string; created_at: string; products: { name: string } | null }
type OrderRow = { id: string; status: string; created_at: string }
type PurchaseRow = { product_id: string; estimated_price: number; orders: { created_at: string } }

export default function OverviewPage() {
  const [products, setProducts] = useState<ProductKpi[]>([])
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [lastPurchasePrices, setLastPurchasePrices] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    Promise.all([
      supabase.from('products').select('id, current_stock, min_stock, last_price'),
      supabase.from('stock_movements')
        .select('product_id, quantity, type, created_at, products(name)')
        .gte('created_at', ONE_YEAR_AGO)
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase.from('orders').select('id, status, created_at').gte('created_at', THIRTY_DAYS_AGO),
      supabase.from('order_items')
        .select('product_id, estimated_price, orders!inner(created_at)')
        .eq('orders.status', 'received')
        .not('estimated_price', 'is', null),
    ]).then(([{ data: p }, { data: m }, { data: o }, { data: purchases }]) => {
      setProducts((p ?? []) as ProductKpi[])
      setMovements((m as unknown as MovementRow[]) ?? [])
      setOrders(o ?? [])
      // Build a map of product_id → most recent actual purchase price
      const rows = (purchases ?? []) as unknown as PurchaseRow[]
      rows.sort((a, b) => new Date(b.orders.created_at).getTime() - new Date(a.orders.created_at).getTime())
      const prices: Record<string, number> = {}
      for (const row of rows) {
        if (!(row.product_id in prices)) prices[row.product_id] = row.estimated_price
      }
      setLastPurchasePrices(prices)
      setLoading(false)
    })
  }, [])

  const THIRTY_DAYS_AGO = useMemo(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), [])
  // Use most recent purchase price per product; fall back to last_price if never ordered
  const totalValue = useMemo(
    () => products.reduce((sum, p) => sum + p.current_stock * (lastPurchasePrices[p.id] ?? p.last_price ?? 0), 0),
    [products, lastPurchasePrices]
  )
  const movementsThisMonth = useMemo(() => movements.filter(m => m.created_at >= THIRTY_DAYS_AGO).length, [movements, THIRTY_DAYS_AGO])
  const stockHealth = useMemo(() => ({
    green:  products.filter(p => p.current_stock > p.min_stock * 1.5).length,
    orange: products.filter(p => p.current_stock > p.min_stock && p.current_stock <= p.min_stock * 1.5).length,
    red:    products.filter(p => p.current_stock <= p.min_stock).length,
  }), [products])
  const topProducts = useMemo(() => {
    const usageCounts: Record<string, { name: string; count: number; quantity: number }> = {}
    movements.filter(m => m.type === 'scan_out' || m.type === 'manual_out').forEach(m => {
      const name = m.products?.name ?? m.product_id
      if (!usageCounts[m.product_id]) usageCounts[m.product_id] = { name, count: 0, quantity: 0 }
      usageCounts[m.product_id].count++
      usageCounts[m.product_id].quantity += m.quantity
    })
    return Object.entries(usageCounts).sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 10)
  }, [movements])
  const dailyData = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const day = new Date(today)
      day.setDate(today.getDate() - (13 - i))
      day.setHours(0, 0, 0, 0)
      const nextDay = new Date(day); nextDay.setDate(day.getDate() + 1)
      const nextTs = nextDay.getTime(); const dayTs = day.getTime()
      let inQty = 0, outQty = 0
      for (const m of movements) {
        const t = new Date(m.created_at).getTime()
        if (t < dayTs || t >= nextTs) continue
        if (m.type === 'scan_in' || m.type === 'manual_in') inQty += m.quantity
        else if (m.type === 'scan_out' || m.type === 'manual_out') outQty += m.quantity
      }
      return { label: day.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), shortLabel: day.toLocaleDateString('de-DE', { day: 'numeric' }), in: inQty, out: outQty }
    })
  }, [movements])
  const maxDaily = useMemo(() => Math.max(...dailyData.map(d => d.in + d.out), 1), [dailyData])
  const orderStatuses = useMemo(() => orders.reduce<Record<string, number>>((acc, o) => { acc[o.status] = (acc[o.status] ?? 0) + 1; return acc }, {}), [orders])

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

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
          value={String(orders.length)} />
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

      {/* 14-day timeline */}
      <Section title="Lagerbewegungen — 14 Tage">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /><span className="text-xs text-slate-500">Eingang</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-sky-400" /><span className="text-xs text-slate-500">Ausgang</span></div>
          </div>
          <div className="flex items-end gap-0.5 h-20">
            {dailyData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-px">
                <div className="w-full flex flex-col justify-end" style={{ height: `${Math.max(2, ((d.in + d.out) / maxDaily) * 64)}px` }}>
                  {d.in > 0 && <div className="w-full bg-emerald-400 rounded-t-sm" style={{ flex: d.in }} />}
                  {d.out > 0 && <div className="w-full bg-sky-400" style={{ flex: d.out }} />}
                  {d.in === 0 && d.out === 0 && <div className="w-full bg-slate-100 rounded-sm" style={{ height: 2 }} />}
                </div>
                {(i === 0 || i === 6 || i === 13) && (
                  <span className="text-slate-400 mt-1" style={{ fontSize: 9 }}>{d.shortLabel}</span>
                )}
              </div>
            ))}
          </div>
          {movements.length === 0 && (
            <p className="text-xs text-slate-400 text-center mt-3">Noch keine Bewegungen erfasst</p>
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
