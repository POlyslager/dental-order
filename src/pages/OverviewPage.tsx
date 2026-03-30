import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Euro, ShoppingCart, Activity, AlertTriangle, Scan, FileDown, X, Info, PackageX } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

type ProductRow = {
  id: string; name: string; current_stock: number; min_stock: number;
  last_price: number | null; category: string | null; preferred_supplier: string | null;
  supplier_url: string | null; barcode: string | null; brand: string | null;
  created_at: string | null;
  expiry_date: string | null;
  lot_number: string | null;
  treatment_types: string[] | null;
}

type MovRow = {
  product_id: string; quantity: number; type: string; created_at: string;
  products: { name: string; category: string | null } | null
}

type OIRow = {
  product_id: string; estimated_price: number | null; quantity: number;
  orders: { id: string; status: string; created_at: string; received_at: string | null }
  products: { name: string; preferred_supplier: string | null; category: string | null } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtEur(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtInt(n: number) {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 0 })
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7)
}

function lastNMonths(n: number) {
  const now = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }),
    }
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

type DashTab = 'finanzen' | 'lager' | 'produkte'

export default function OverviewPage() {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [movements, setMovements] = useState<MovRow[]>([])
  const [orderItems, setOrderItems] = useState<OIRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dashTab, setDashTab] = useState<DashTab>('finanzen')
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfPeriodType, setPdfPeriodType] = useState<'month' | 'year'>('month')
  const [lagerActiveIn, setLagerActiveIn] = useState<number | null>(null)
  const [lagerActiveOut, setLagerActiveOut] = useState<number | null>(null)
  const [pdfPeriodValue, setPdfPeriodValue] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    Promise.all([
      supabase.from('products')
        .select('id, name, current_stock, min_stock, last_price, category, preferred_supplier, supplier_url, barcode, brand, created_at, expiry_date, lot_number, treatment_types')
        .limit(10000),
      supabase.from('stock_movements')
        .select('product_id, quantity, type, created_at, products(name, category)')
        .gte('created_at', ONE_YEAR_AGO)
        .order('created_at', { ascending: false })
        .limit(10000),
      supabase.from('order_items')
        .select('product_id, estimated_price, quantity, orders!inner(id, status, created_at, received_at), products(name, preferred_supplier, category)')
        .limit(10000),
    ]).then(([{ data: p }, { data: m }, { data: oi }]) => {
      setProducts((p ?? []) as ProductRow[])
      setMovements((m as unknown as MovRow[]) ?? [])
      setOrderItems((oi as unknown as OIRow[]) ?? [])
      setLoading(false)
    })
  }, [])

  const months12 = useMemo(() => lastNMonths(12), [])

  // ── KPI: Lagerwert ──────────────────────────────────────────────────────────
  const totalValue = useMemo(
    () => products.reduce((sum, p) => sum + p.current_stock * (p.last_price ?? 0), 0),
    [products]
  )

  // ── KPI: Open orders ───────────────────────────────────────────────────────
  const openItems = useMemo(
    () => orderItems.filter(oi => oi.orders?.status === 'ordered'),
    [orderItems]
  )
  const openOrdersValue = useMemo(
    () => openItems.reduce((sum, oi) => sum + (oi.estimated_price ?? 0) * oi.quantity, 0),
    [openItems]
  )
  const openOrdersCount = useMemo(
    () => new Set(openItems.map(oi => oi.orders?.id)).size,
    [openItems]
  )

  // ── KPI: Movements today / this week ───────────────────────────────────────
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
  }, [])
  const weekStart = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.toISOString()
  }, [])
  const movementsToday = useMemo(() => movements.filter(m => m.created_at >= todayStart).length, [movements, todayStart])
  const movementsWeek = useMemo(() => movements.filter(m => m.created_at >= weekStart).length, [movements, weekStart])

  // ── KPI: Missing data ──────────────────────────────────────────────────────
  const noSupplierCount = useMemo(() => products.filter(p => !p.preferred_supplier).length, [products])
  const noBarcodeCount = useMemo(() => products.filter(p => !p.barcode).length, [products])

  // ── Lagergesundheit bidirectional: in/out quantities per month ─────────────
  const lagerData = useMemo(() => {
    const inMap: Record<string, number> = {}
    const outMap: Record<string, number> = {}
    for (const m of movements) {
      const k = monthKey(m.created_at)
      if (m.type === 'scan_in' || m.type === 'manual_in') inMap[k] = (inMap[k] ?? 0) + m.quantity
      else if (m.type === 'scan_out' || m.type === 'manual_out') outMap[k] = (outMap[k] ?? 0) + m.quantity
    }
    return months12.map(month => ({ ...month, in: inMap[month.key] ?? 0, out: outMap[month.key] ?? 0 }))
  }, [movements, months12])
  const maxLager = useMemo(() => Math.max(...lagerData.map(d => Math.max(d.in, d.out)), 1), [lagerData])

  // ── Monthly purchasing cost trend (received orders) ────────────────────────
  const monthlySpend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const k = monthKey(oi.orders.created_at)
      map[k] = (map[k] ?? 0) + (oi.estimated_price ?? 0) * oi.quantity
    }
    return months12.map(m => ({ ...m, value: map[m.key] ?? 0 }))
  }, [orderItems, months12])
  const maxSpend = useMemo(() => Math.max(...monthlySpend.map(d => d.value), 1), [monthlySpend])

  // ── Cancelled/retracted approvals per month ────────────────────────────────
  const cancelledByMonth = useMemo(() => {
    const seen = new Map<string, string>() // order_id → month_key
    for (const oi of orderItems) {
      if ((oi.orders?.status === 'retracted' || oi.orders?.status === 'cancelled') && oi.orders?.id) {
        seen.set(oi.orders.id, monthKey(oi.orders.created_at))
      }
    }
    const counts: Record<string, number> = {}
    seen.forEach(mk => { counts[mk] = (counts[mk] ?? 0) + 1 })
    return months12.map(m => ({ label: m.label, value: counts[m.key] ?? 0 }))
  }, [orderItems, months12])
  const maxCancelled = useMemo(() => Math.max(...cancelledByMonth.map(d => d.value), 1), [cancelledByMonth])

  // ── Avg order value per month (received orders) ────────────────────────────
  const avgOrderValueByMonth = useMemo(() => {
    const map: Record<string, { total: number; orderIds: Set<string> }> = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const k = monthKey(oi.orders.created_at)
      if (!map[k]) map[k] = { total: 0, orderIds: new Set() }
      map[k].total += (oi.estimated_price ?? 0) * oi.quantity
      map[k].orderIds.add(oi.orders.id)
    }
    return months12.map(m => ({
      ...m,
      value: map[m.key] ? map[m.key].total / map[m.key].orderIds.size : 0,
    }))
  }, [orderItems, months12])
  const maxAvgOrderValue = useMemo(() => Math.max(...avgOrderValueByMonth.map(d => d.value), 1), [avgOrderValueByMonth])

  // ── Spend by category ──────────────────────────────────────────────────────
  const categorySpend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const cat = oi.products?.category ?? 'Ohne Kategorie'
      map[cat] = (map[cat] ?? 0) + (oi.estimated_price ?? 0) * oi.quantity
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [orderItems])
  const maxCatSpend = useMemo(() => Math.max(...categorySpend.map(c => c[1]), 1), [categorySpend])

  // ── Spend by supplier (total, received) ────────────────────────────────────
  const supplierSpend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const sup = oi.products?.preferred_supplier ?? 'Kein Lieferant'
      map[sup] = (map[sup] ?? 0) + (oi.estimated_price ?? 0) * oi.quantity
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [orderItems])
  const maxSupSpend = useMemo(() => Math.max(...supplierSpend.map(s => s[1]), 1), [supplierSpend])

  // ── Top 10 most used products (stock out movements) ────────────────────────
  const topUsed = useMemo(() => {
    const map: Record<string, { name: string; quantity: number }> = {}
    for (const m of movements) {
      if (m.type !== 'scan_out' && m.type !== 'manual_out') continue
      const name = m.products?.name ?? m.product_id
      if (!map[m.product_id]) map[m.product_id] = { name, quantity: 0 }
      map[m.product_id].quantity += m.quantity
    }
    return Object.values(map).sort((a, b) => b.quantity - a.quantity).slice(0, 10)
  }, [movements])

  // ── Top 10 most expensive products (total annual spend) ────────────────────
  const topExpensive = useMemo(() => {
    const map: Record<string, { name: string; value: number }> = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const name = oi.products?.name ?? oi.product_id
      if (!map[oi.product_id]) map[oi.product_id] = { name, value: 0 }
      map[oi.product_id].value += (oi.estimated_price ?? 0) * oi.quantity
    }
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 10)
  }, [orderItems])


  // ── Orders by period vs average ─────────────────────────────────────────────
  // Unique order IDs with dates from orderItems (non-cancelled)
  const allOrders = useMemo(() => {
    const map = new Map<string, string>() // id → created_at
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'cancelled' && oi.orders?.id)
        map.set(oi.orders.id, oi.orders.created_at)
    }
    return Array.from(map.values())
  }, [orderItems])

  const orderPeriods = useMemo(() => {
    const now = new Date()
    // This week (Mon–Sun)
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - now.getDay() + 1); thisWeekStart.setHours(0,0,0,0)
    // This month
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    // This year
    const thisYearStart = new Date(now.getFullYear(), 0, 1)

    const thisWeek  = allOrders.filter(d => new Date(d) >= thisWeekStart).length
    const thisMonth = allOrders.filter(d => new Date(d) >= thisMonthStart).length
    const thisYear  = allOrders.filter(d => new Date(d) >= thisYearStart).length

    // Averages: weekly avg over 52 weeks, monthly avg over 12 months
    const yr52ago = new Date(now.getTime() - 52 * weekMs).toISOString()
    const weeksCount = allOrders.filter(d => d >= yr52ago).length / 52
    const mo12ago = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    const monthsCount = allOrders.filter(d => new Date(d) >= mo12ago).length / 12

    return { thisWeek, thisMonth, thisYear, avgWeek: weeksCount, avgMonth: monthsCount }
  }, [allOrders])


  // ── Supplier concentration ───────────────────────────────────────────────────
  const supplierConcentration = useMemo(() => {
    const total = supplierSpend.reduce((s, [, v]) => s + v, 0)
    if (total === 0) return []
    const top3 = supplierSpend.slice(0, 3)
    const othersVal = total - top3.reduce((s, [, v]) => s + v, 0)
    const result = top3.map(([name, val]) => ({ name, val, pct: val / total }))
    if (othersVal > 0) result.push({ name: 'Übrige', val: othersVal, pct: othersVal / total })
    return result
  }, [supplierSpend])

  // ── Produkte unter Mindestbestand ────────────────────────────────────────────
  const belowMinStock = useMemo(() =>
    products
      .filter(p => p.current_stock < p.min_stock)
      .sort((a, b) => (a.current_stock / Math.max(a.min_stock, 1)) - (b.current_stock / Math.max(b.min_stock, 1)))
      .slice(0, 10)
      .map(p => ({ name: p.name, current: p.current_stock, min: p.min_stock, pct: p.current_stock / Math.max(p.min_stock, 1) }))
  , [products])

  // ── Lagerumschlag per category ───────────────────────────────────────────────
  const lagerumschlag = useMemo(() => {
    const outByCategory: Record<string, number> = {}
    const productsByCategory: Record<string, number> = {}
    for (const m of movements) {
      if (m.type !== 'scan_out' && m.type !== 'manual_out') continue
      const cat = m.products?.category ?? 'Ohne Kategorie'
      outByCategory[cat] = (outByCategory[cat] ?? 0) + m.quantity
    }
    for (const p of products) {
      const cat = p.category ?? 'Ohne Kategorie'
      productsByCategory[cat] = (productsByCategory[cat] ?? 0) + 1
    }
    return Object.entries(outByCategory)
      .map(([cat, out]) => ({ cat, out, products: productsByCategory[cat] ?? 1, rate: out / (productsByCategory[cat] ?? 1) }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 8)
  }, [movements, products])
  const maxLU = useMemo(() => Math.max(...lagerumschlag.map(d => d.rate), 1), [lagerumschlag])


  // ── Bestellzyklen (avg days between orders per product, top 10 most regular) ─
  const bestellzyklen = useMemo(() => {
    const ordersByProduct = new Map<string, { name: string; dates: number[] }>()
    for (const oi of orderItems) {
      if (oi.orders?.status === 'cancelled') continue
      const id = oi.product_id
      const name = oi.products?.name ?? id
      const ts = new Date(oi.orders.created_at).getTime()
      if (!ordersByProduct.has(id)) ordersByProduct.set(id, { name, dates: [] })
      ordersByProduct.get(id)!.dates.push(ts)
    }
    const results: { name: string; avgDays: number; orderCount: number }[] = []
    for (const { name, dates } of ordersByProduct.values()) {
      if (dates.length < 2) continue
      dates.sort((a, b) => a - b)
      const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / (1000 * 60 * 60 * 24))
      const avgDays = gaps.reduce((a, b) => a + b, 0) / gaps.length
      results.push({ name, avgDays: Math.round(avgDays), orderCount: dates.length })
    }
    return results.sort((a, b) => a.avgDays - b.avgDays).slice(0, 10)
  }, [orderItems])

  // ── Produkte ohne Bewegung (90+ days) ────────────────────────────────────────
  const noMovement90 = useMemo(() => {
    const lastMovement = new Map<string, number>()
    for (const m of movements) {
      const ts = new Date(m.created_at).getTime()
      if (!lastMovement.has(m.product_id) || ts > lastMovement.get(m.product_id)!) {
        lastMovement.set(m.product_id, ts)
      }
    }
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    return products
      .filter(p => {
        const last = lastMovement.get(p.id)
        return !last || last < cutoff
      })
      .map(p => {
        const last = lastMovement.get(p.id)
        const daysSince = last ? Math.floor((Date.now() - last) / (1000 * 60 * 60 * 24)) : null
        return { name: p.name, category: p.category ?? '–', daysSince }
      })
      .sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999))
      .slice(0, 15)
  }, [products, movements])

  // ── Neue Artikel pro Monat ───────────────────────────────────────────────────
  const newProductsByMonth = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of products) {
      if (!p.created_at) continue
      const k = monthKey(p.created_at)
      map[k] = (map[k] ?? 0) + 1
    }
    return months12.map(m => ({ ...m, value: map[m.key] ?? 0 }))
  }, [products, months12])
  const maxNewProducts = useMemo(() => Math.max(...newProductsByMonth.map(d => d.value), 1), [newProductsByMonth])

  // ── Ablaufende Produkte (Lager tab) ─────────────────────────────────────────
  const expiringProducts = useMemo(() => {
    const today = new Date()
    return (products ?? [])
      .filter(p => p.expiry_date)
      .map(p => ({ ...p, daysLeft: Math.ceil((new Date(p.expiry_date!).getTime() - today.getTime()) / (1000*60*60*24)) }))
      .filter(p => p.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [products])

  // ── Lieferantenperformance (Finanzen tab) ────────────────────────────────────
  const supplierPerformance = useMemo(() => {
    type SupData = { totalOrders: Set<string>; orderDates: number[]; deliveryDays: number[]; totalValue: number }
    const map: Record<string, SupData> = {}
    for (const oi of orderItems) {
      const sup = oi.products?.preferred_supplier ?? 'Kein Lieferant'
      if (!map[sup]) map[sup] = { totalOrders: new Set(), orderDates: [], deliveryDays: [], totalValue: 0 }
      const ts = new Date(oi.orders.created_at).getTime()
      if (!map[sup].totalOrders.has(oi.orders.id)) {
        map[sup].orderDates.push(ts)
      }
      map[sup].totalOrders.add(oi.orders.id)
      map[sup].totalValue += (oi.estimated_price ?? 0) * oi.quantity
      if (oi.orders.status === 'received' && oi.orders.received_at && oi.orders.created_at) {
        const days = (new Date(oi.orders.received_at).getTime() - new Date(oi.orders.created_at).getTime()) / (1000 * 60 * 60 * 24)
        if (days >= 0) map[sup].deliveryDays.push(days)
      }
    }
    return Object.entries(map)
      .map(([name, d]) => {
        const sortedDates = d.orderDates.slice().sort((a, b) => a - b)
        const intervals = sortedDates.slice(1).map((d, i) => (d - sortedDates[i]) / (1000 * 60 * 60 * 24))
        const avgOrderInterval = intervals.length > 0
          ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
          : null
        return {
          name,
          avgDeliveryDays: d.deliveryDays.length > 0
            ? Math.round(d.deliveryDays.reduce((a, b) => a + b, 0) / d.deliveryDays.length)
            : null,
          avgOrderInterval,
          totalOrders: d.totalOrders.size,
          totalValue: d.totalValue,
        }
      })
      .sort((a, b) => b.totalValue - a.totalValue)
  }, [orderItems])

  // ── Behandlungstypen-Verteilung (Produkte tab) ───────────────────────────────
  const treatmentTypeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of products ?? []) {
      for (const t of (p.treatment_types ?? [])) {
        counts[t] = (counts[t] ?? 0) + 1
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [products])
  const maxTreatmentCount = useMemo(() => Math.max(...treatmentTypeBreakdown.map(([, c]) => c), 1), [treatmentTypeBreakdown])

  // ── KPI 7: Fehlbestandsquote — % of tracked products at zero stock ─────────
  const fehlbestandsquote = useMemo(() => {
    const tracked = products.filter(p => p.min_stock > 0)
    if (tracked.length === 0) return null
    const atZero = tracked.filter(p => p.current_stock <= 0).length
    return Math.round((atZero / tracked.length) * 100)
  }, [products])


  // ── KPI 13: Wiederbestellquote — % of products ordered more than once ───────
  const wiederbestellquote = useMemo(() => {
    const ordersByProduct = new Map<string, Set<string>>()
    for (const oi of orderItems) {
      if (oi.orders?.status === 'cancelled' || !oi.orders?.id) continue
      if (!ordersByProduct.has(oi.product_id)) ordersByProduct.set(oi.product_id, new Set())
      ordersByProduct.get(oi.product_id)!.add(oi.orders.id)
    }
    const total = ordersByProduct.size
    if (total === 0) return null
    const reordered = [...ordersByProduct.values()].filter(s => s.size > 1).length
    return Math.round((reordered / total) * 100)
  }, [orderItems])

  // ── KPI 14: Notbestellquote — % of active ordered products with stock = 0 ──
  const notbestellquote = useMemo(() => {
    const activeItems = orderItems.filter(oi => oi.orders?.status === 'ordered')
    const productIds = [...new Set(activeItems.map(oi => oi.product_id))]
    if (productIds.length === 0) return null
    const pMap = new Map(products.map(p => [p.id, p]))
    const atZero = productIds.filter(id => (pMap.get(id)?.current_stock ?? 1) <= 0).length
    return Math.round((atZero / productIds.length) * 100)
  }, [orderItems, products])


  // ── KPI 22: Monthly spend by category (top 4 + Übrige) ────────────────────
  const categoryMonthlySpend = useMemo(() => {
    const topCats = categorySpend.slice(0, 4).map(([cat]) => cat)
    const data: Record<string, Record<string, number>> = {}
    for (const m of months12) data[m.key] = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const k = monthKey(oi.orders.created_at)
      if (!data[k]) continue
      const cat = oi.products?.category ?? 'Ohne Kategorie'
      const bucket = topCats.includes(cat) ? cat : 'Übrige'
      data[k][bucket] = (data[k][bucket] ?? 0) + (oi.estimated_price ?? 0) * oi.quantity
    }
    const buckets = [...topCats, 'Übrige'].filter(b =>
      months12.some(m => (data[m.key]?.[b] ?? 0) > 0)
    )
    const maxTotal = Math.max(...months12.map(m => Object.values(data[m.key] ?? {}).reduce((a, b) => a + b, 0)), 1)
    return { months: months12.map(m => ({ ...m, values: data[m.key] ?? {} })), buckets, maxTotal }
  }, [orderItems, months12, categorySpend])

  // ── KPI 26: Spend by treatment type ───────────────────────────────────────
  const treatmentTypeSpend = useMemo(() => {
    const pMap = new Map(products.map(p => [p.id, p]))
    const map: Record<string, number> = {}
    for (const oi of orderItems) {
      if (oi.orders?.status !== 'received') continue
      const p = pMap.get(oi.product_id)
      for (const t of (p?.treatment_types ?? [])) {
        map[t] = (map[t] ?? 0) + (oi.estimated_price ?? 0) * oi.quantity
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [orderItems, products])
  const maxTreatmentSpend = useMemo(() => Math.max(...treatmentTypeSpend.map(([, v]) => v), 1), [treatmentTypeSpend])

  // ── Available years for PDF export ──────────────────────────────────────────
  const availableYears = useMemo(() => {
    const years = new Set<string>()
    for (const oi of orderItems) {
      if (oi.orders?.created_at) years.add(oi.orders.created_at.slice(0, 4))
    }
    return Array.from(years).sort().reverse()
  }, [orderItems])

  function handleExportPDF() {
    const periodLabel = pdfPeriodType === 'month'
      ? new Date(pdfPeriodValue + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
      : pdfPeriodValue

    const filtered = orderItems.filter(oi => {
      const date = oi.orders?.created_at
      if (!date) return false
      return date.startsWith(pdfPeriodValue)
    })

    const productMap: Record<string, { name: string; category: string; supplier: string; qty: number; total: number; priceSum: number; priceCount: number }> = {}
    for (const oi of filtered) {
      const id = oi.product_id
      if (!productMap[id]) productMap[id] = {
        name: oi.products?.name ?? '–',
        category: oi.products?.category ?? '–',
        supplier: oi.products?.preferred_supplier ?? '–',
        qty: 0, total: 0, priceSum: 0, priceCount: 0,
      }
      productMap[id].qty += oi.quantity
      productMap[id].total += (oi.estimated_price ?? 0) * oi.quantity
      if (oi.estimated_price != null) { productMap[id].priceSum += oi.estimated_price; productMap[id].priceCount++ }
    }

    const rows = Object.values(productMap).sort((a, b) => b.total - a.total)
    const grandTotal = rows.reduce((s, r) => s + r.total, 0)

    const tableRows = rows.map(r => `
      <tr>
        <td>${r.name}</td>
        <td>${r.category}</td>
        <td>${r.supplier}</td>
        <td style="text-align:right">${r.qty}</td>
        <td style="text-align:right">${r.priceCount > 0 ? '€ ' + fmtEur(r.priceSum / r.priceCount) : '–'}</td>
        <td style="text-align:right">€ ${fmtEur(r.total)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>DentalOrder – Finanzübersicht ${periodLabel}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .subtitle { color: #64748b; margin: 0 0 24px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #e2e8f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
    .total-row td { font-weight: 700; border-top: 2px solid #e2e8f0; border-bottom: none; padding-top: 12px; }
    .empty { text-align: center; color: #94a3b8; padding: 32px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>DentalOrder – Finanzübersicht</h1>
  <p class="subtitle">Zeitraum: ${periodLabel} &nbsp;·&nbsp; Erstellt am ${new Date().toLocaleDateString('de-DE')}</p>
  ${rows.length === 0 ? '<p class="empty">Keine Bestellungen in diesem Zeitraum</p>' : `
  <table>
    <thead>
      <tr>
        <th>Produkt</th><th>Kategorie</th><th>Lieferant</th>
        <th style="text-align:right">Menge</th>
        <th style="text-align:right">Ø Preis</th>
        <th style="text-align:right">Gesamt</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      <tr class="total-row">
        <td colspan="5">Gesamt</td>
        <td style="text-align:right">€ ${fmtEur(grandTotal)}</td>
      </tr>
    </tbody>
  </table>`}
</body>
</html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
    setPdfOpen(false)
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const DASH_TABS: { id: DashTab; label: string }[] = [
    { id: 'finanzen',  label: 'Finanzen' },
    { id: 'lager',     label: 'Lager' },
    { id: 'produkte',  label: 'Produkte' },
  ]

  return (
    <div className="pb-10">

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 px-4 lg:px-6 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center">
          <div className="flex flex-1">
            {DASH_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setDashTab(t.id)}
                className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
                  dashTab === t.id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {dashTab === 'finanzen' && (
            <button
              onClick={() => setPdfOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors"
            >
              <FileDown size={13} />
              Exportieren
            </button>
          )}
        </div>
      </div>

      <div className="p-4 lg:p-6">

        {/* ══ FINANZEN ════════════════════════════════════════════════════════ */}
        {dashTab === 'finanzen' && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

            {/* KPI row */}
            <div className="col-span-2 lg:col-span-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
              <div className="flex divide-x divide-slate-100 dark:divide-slate-700 overflow-x-auto">
                {[
                  { icon: <Euro size={20} />,         iconBg: 'bg-sky-100 dark:bg-sky-900/40',       iconColor: 'text-sky-600',    label: 'Lagerwert',                               value: `€ ${fmtInt(totalValue)}` },
                  { icon: <ShoppingCart size={20} />, iconBg: 'bg-violet-100 dark:bg-violet-900/40', iconColor: 'text-violet-600', label: `Offene Bestellungen (${openOrdersCount})`, value: `€ ${fmtInt(openOrdersValue)}` },
                ].map((kpi, i, arr) => (
                  <div key={i} className={`flex-1 flex items-center gap-3 px-5 py-4 min-w-0 shrink-0 ${i === 0 ? 'rounded-l-2xl' : ''} ${i === arr.length - 1 ? 'rounded-r-2xl' : ''}`}>
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${kpi.iconBg}`}>
                      <span className={kpi.iconColor}>{kpi.icon}</span>
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{kpi.label}</p>
                      <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight">{kpi.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Monatliche Einkaufskosten — spans 2 cols, paired with Bestellungen on lg */}
            <Card title="Monatliche Einkaufskosten" className="col-span-2" tooltip="Gesamtausgaben für erhaltene Bestellungen pro Monat der letzten 12 Monate.">
              <div className="px-4 pt-2 pb-4">
                <MonthlyTrendChart data={monthlySpend} max={maxSpend} />
              </div>
            </Card>

            {/* Bestellungen im Vergleich — sits in col 3 on lg, stacks vertically */}
            <Card title="Bestellungen" className="col-span-2 lg:col-span-1" tooltip="Anzahl aufgegebener Bestellungen in dieser Woche, diesem Monat und diesem Jahr – verglichen mit dem jeweiligen Durchschnitt der letzten 12 Monate.">
              <div className="px-4 pb-4 space-y-4">
                {([
                  { label: 'Diese Woche', value: orderPeriods.thisWeek, avg: orderPeriods.avgWeek, unit: 'Ø/Woche' },
                  { label: 'Dieser Monat', value: orderPeriods.thisMonth, avg: orderPeriods.avgMonth, unit: 'Ø/Monat' },
                  { label: 'Dieses Jahr', value: orderPeriods.thisYear, avg: null, unit: null },
                ]).map((item, i) => (
                  <div key={i}>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{item.label}</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight">{item.value}</p>
                    {item.avg != null && (
                      <p className={`text-xs mt-0.5 font-medium ${item.value >= item.avg ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {item.value >= item.avg ? '↑' : '↓'} {item.unit}: {item.avg.toFixed(1)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {/* Stornierte Bestellungen */}
            <Card title="Stornierte Bestellungen" className="col-span-2 lg:col-span-1" tooltip="Anzahl stornierter oder zurückgezogener Bestellungen pro Monat. Enthält abgelehnte Freigaben und Bestellungen, bei denen der Betrag nachträglich unter die Genehmigungsschwelle gesenkt wurde. Häufige Einträge können auf Missbrauch hinweisen.">
              <div className="px-4 pb-4">
                <VerticalBars
                  data={cancelledByMonth}
                  max={maxCancelled}
                  barColor="#f97316"
                  formatValue={v => String(v)}
                  empty="Keine stornierten Bestellungen"
                />
              </div>
            </Card>

            {/* Ø Bestellwert pro Monat */}
            <Card title="Ø Bestellwert pro Monat" className="col-span-2 lg:col-span-3" tooltip="Durchschnittlicher Wert einer erhaltenen Bestellung pro Monat der letzten 12 Monate (Gesamtausgaben ÷ Anzahl Bestellungen).">
              <div className="px-4 pt-2 pb-4">
                <VerticalBars
                  data={avgOrderValueByMonth.map(d => ({ label: d.label, value: d.value }))}
                  max={maxAvgOrderValue}
                  barColor="#34d399"
                  formatValue={v => `€${fmtInt(v)}`}
                />
              </div>
            </Card>

            {/* Ausgaben nach Kategorie */}
            <Card title="Ausgaben nach Kategorie" tooltip="Gesamtausgaben pro Produktkategorie für alle erhaltenen Bestellungen.">
              <div className="px-4 pb-4">
                <VerticalBars
                  data={categorySpend.map(([label, value]) => ({ label, value }))}
                  max={maxCatSpend}
                  barColor="#a78bfa"
                  formatValue={v => `€${fmtInt(v)}`}
                />
              </div>
            </Card>

            {/* Ausgaben nach Lieferant + Lieferanten-Konzentration side by side */}
            <div className="col-span-2 grid grid-cols-2 gap-4">

            <Card title="Ausgaben nach Lieferant" tooltip="Gesamtausgaben pro Lieferant für alle erhaltenen Bestellungen.">
              <div className="px-4 pb-4">
                <VerticalBars
                  data={supplierSpend.map(([label, value]) => ({ label, value }))}
                  max={maxSupSpend}
                  barColor="#38bdf8"
                  formatValue={v => `€${fmtInt(v)}`}
                />
              </div>
            </Card>

            {/* Lieferanten-Konzentration */}
            <Card title="Lieferanten-Konzentration" tooltip="Zeigt wie stark die Ausgaben auf einzelne Lieferanten konzentriert sind. Ein hoher Anteil eines Lieferanten bedeutet ein höheres Abhängigkeitsrisiko.">
              <div className="px-4 pb-4 flex-1 flex flex-col justify-center">
                {supplierConcentration.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Keine Daten</p>
                ) : (
                  <>
                    <div className="flex h-4 rounded-full overflow-hidden gap-px mb-4">
                      {supplierConcentration.map((s, i) => {
                        const colors = ['bg-sky-400', 'bg-violet-400', 'bg-amber-400', 'bg-slate-200']
                        return <div key={i} className={colors[i] ?? 'bg-slate-200'} style={{ width: `${s.pct * 100}%` }} />
                      })}
                    </div>
                    <div className="space-y-2">
                      {supplierConcentration.map((s, i) => {
                        const colors = ['bg-sky-400', 'bg-violet-400', 'bg-amber-400', 'bg-slate-200']
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${colors[i] ?? 'bg-slate-200'}`} />
                            <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{s.name}</span>
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0">{(s.pct * 100).toFixed(1)}%</span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 w-20 text-right">€ {fmtInt(s.val)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </Card>

            </div>{/* end side-by-side wrapper */}

            {/* Lieferantenperformance */}
            <Card title="Lieferantenperformance" className="col-span-2 lg:col-span-3" tooltip="Durchschnittliche Lieferzeit und Erfüllungsrate pro Lieferant, basierend auf abgeschlossenen Bestellungen.">
              <div className="px-4 pb-4">
                {supplierPerformance.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Noch keine abgeschlossenen Bestellungen.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                          <th className="text-left text-xs font-medium text-slate-400 dark:text-slate-500 pb-2 pr-4">Lieferant</th>
                          <th className="text-right text-xs font-medium text-slate-400 dark:text-slate-500 pb-2 px-4">Lieferzeit (∅ Tage)</th>
                          <th className="text-right text-xs font-medium text-slate-400 dark:text-slate-500 pb-2 px-4">Bestellungen</th>
                          <th className="text-right text-xs font-medium text-slate-400 dark:text-slate-500 pb-2 px-4">Ø Bestellintervall</th>
                          <th className="text-right text-xs font-medium text-slate-400 dark:text-slate-500 pb-2 pl-4">Umsatz</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                        {supplierPerformance.map((s, i) => (
                          <tr key={i}>
                            <td className="py-2.5 pr-4 text-slate-700 dark:text-slate-200 font-medium truncate max-w-[180px]">{s.name}</td>
                            <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300">
                              {s.avgDeliveryDays != null ? `${s.avgDeliveryDays}d` : <span className="text-slate-300 dark:text-slate-600">–</span>}
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300">{s.totalOrders}</td>
                            <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300">
                              {s.avgOrderInterval != null ? `${s.avgOrderInterval}d` : <span className="text-slate-300 dark:text-slate-600">–</span>}
                            </td>
                            <td className="py-2.5 pl-4 text-right text-slate-700 dark:text-slate-200 font-semibold">€ {fmtInt(s.totalValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>

            {/* Monatliche Kosten nach Kategorie */}
            <Card title="Monatliche Kosten nach Kategorie" className="col-span-2 lg:col-span-3" tooltip="Ausgaben pro Kategorie aufgeschlüsselt nach Monat der letzten 12 Monate.">
              <div className="px-4 pt-4 pb-4">
                {categoryMonthlySpend.buckets.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Keine Daten</p>
                ) : (
                  <StackedMonthlyBars data={categoryMonthlySpend.months} buckets={categoryMonthlySpend.buckets} maxTotal={categoryMonthlySpend.maxTotal} />
                )}
              </div>
            </Card>

          </div>
        )}

        {/* ══ LAGER ═══════════════════════════════════════════════════════════ */}
        {dashTab === 'lager' && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

            {/* KPI row */}
            <div className="col-span-2 lg:col-span-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
              <div className="flex divide-x divide-slate-100 dark:divide-slate-700 overflow-x-auto">
                {[
                  { icon: <Activity size={20} />,      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40', iconColor: 'text-emerald-600', label: 'Bewegungen heute / Woche', value: `${movementsToday} / ${movementsWeek}`, tooltip: 'Anzahl der Lagerbewegungen (Ein- und Ausgänge) heute und in den letzten 7 Tagen.' },
                  { icon: <AlertTriangle size={20} />, iconBg: 'bg-amber-100 dark:bg-amber-900/40',   iconColor: 'text-amber-500',   label: 'Artikel ohne Lieferant',  value: String(noSupplierCount) },
                  { icon: <Scan size={20} />,          iconBg: 'bg-slate-100 dark:bg-slate-700',      iconColor: 'text-slate-500 dark:text-slate-400',   label: 'Artikel ohne Barcode',    value: String(noBarcodeCount) },
                  { icon: <PackageX size={20} />,      iconBg: 'bg-red-100 dark:bg-red-900/40',       iconColor: 'text-red-500',     label: 'Fehlbestandsquote',       value: fehlbestandsquote === null ? '–' : `${fehlbestandsquote}%`, tooltip: 'Anteil der Produkte, deren aktueller Bestand bei 0 liegt. Hoher Wert = kritische Versorgungslücken.' },
                  { icon: <AlertTriangle size={20} />, iconBg: 'bg-amber-100 dark:bg-amber-900/40',   iconColor: 'text-amber-500',   label: 'Notbestellquote',         value: notbestellquote === null ? '–' : `${notbestellquote}%`, tooltip: 'Anteil der aktiven Bestellungen, bei denen der Lagerbestand des Artikels 0 beträgt – d.h. dringende Bestellungen wegen fehlendem Bestand.' },
                ].map((kpi, i, arr) => (
                  <div key={i} className={`relative flex-1 flex items-center gap-3 px-5 py-4 min-w-0 shrink-0 ${i === 0 ? 'rounded-l-2xl' : ''} ${i === arr.length - 1 ? 'rounded-r-2xl' : ''}`}>
                    {'tooltip' in kpi && kpi.tooltip && <div className="absolute top-2 right-2"><CardTooltip text={kpi.tooltip} /></div>}
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${kpi.iconBg}`}>
                      <span className={kpi.iconColor}>{kpi.icon}</span>
                    </div>
                    <div className="min-w-0 text-left flex-1">
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{kpi.label}</p>
                      <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight">{kpi.value}</p>
                      {'sub' in kpi && typeof kpi.sub === 'string' && kpi.sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{kpi.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Lagergesundheit — paired with Lagerumschlag on lg */}
            <Card title="Lagergesundheit" className="col-span-2" tooltip="Monatliche Ein- und Ausgänge im Lager der letzten 12 Monate. Grün = erhaltene Lieferungen, Rot = entnommene Artikel.">
              <div className="px-4 pt-4 pb-4">
                <div className="flex items-center gap-4 mb-4">
                  <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" /> Eingang (Lieferung erhalten)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#FF6B6B] inline-block" /> Ausgang (Entnommen)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <div style={{ minWidth: 600 }}>
                    <div className="flex items-end gap-0.5 h-28">
                      {lagerData.map((d, i) => (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center justify-end h-full relative cursor-pointer"
                          onMouseEnter={() => d.in > 0 && setLagerActiveIn(i)}
                          onMouseLeave={() => setLagerActiveIn(null)}
                          onClick={() => d.in > 0 && setLagerActiveIn(lagerActiveIn === i ? null : i)}
                        >
                          {d.in > 0 && <span className="text-slate-600 dark:text-slate-300 font-medium leading-none mb-1" style={{ fontSize: 11 }}>{d.in}</span>}
                          {d.in > 0 && <div className="w-full rounded-t-sm" style={{ height: `${Math.max(4, (d.in / maxLager) * 100)}px`, background: '#34d399', opacity: lagerActiveIn === null || lagerActiveIn === i ? 1 : 0.4 }} />}
                          {lagerActiveIn === i && d.in > 0 && (
                            <div className={`absolute top-1 z-10 pointer-events-none ${i === 0 ? 'left-0' : i === lagerData.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                              <div className="bg-slate-800 text-white text-xs rounded-lg px-2 py-1.5 whitespace-nowrap shadow-lg">
                                <p className="font-semibold">{d.label}</p><p>{d.in} Einheiten erhalten</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="border-t-2 border-slate-300 dark:border-slate-600 flex gap-0.5 pt-1 pb-1">
                      {lagerData.map((d, i) => (
                        <div key={i} className="flex-1 text-center">
                          <span className="text-slate-500 dark:text-slate-400 font-medium leading-none" style={{ fontSize: 11 }}>{d.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start gap-0.5 h-28">
                      {lagerData.map((d, i) => (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center h-full relative cursor-pointer"
                          onMouseEnter={() => d.out > 0 && setLagerActiveOut(i)}
                          onMouseLeave={() => setLagerActiveOut(null)}
                          onClick={() => d.out > 0 && setLagerActiveOut(lagerActiveOut === i ? null : i)}
                        >
                          {d.out > 0 && <div className="w-full rounded-b-sm" style={{ height: `${Math.max(4, (d.out / maxLager) * 100)}px`, background: '#FF6B6B', opacity: lagerActiveOut === null || lagerActiveOut === i ? 1 : 0.4 }} />}
                          {d.out > 0 && <span className="text-slate-600 dark:text-slate-300 font-medium leading-none mt-1" style={{ fontSize: 11 }}>{d.out}</span>}
                          {lagerActiveOut === i && d.out > 0 && (
                            <div className={`absolute top-1 z-10 pointer-events-none ${i === 0 ? 'left-0' : i === lagerData.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                              <div className="bg-slate-800 text-white text-xs rounded-lg px-2 py-1.5 whitespace-nowrap shadow-lg">
                                <p className="font-semibold">{d.label}</p><p>{d.out} Einheiten entnommen</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Lagerumschlag — sits in col 3 on lg, next to Lagergesundheit */}
            <Card title="Lagerumschlag nach Kategorie" className="col-span-2 lg:col-span-1" tooltip="Durchschnittliche Entnahmen pro Artikel je Kategorie. Ein hoher Wert bedeutet schnelle Rotation und hohen Verbrauch.">
              <div className="px-4 pt-4 pb-4">
                <VerticalBars
                  data={lagerumschlag.map(d => ({ label: d.cat, value: d.rate }))}
                  max={maxLU}
                  barColor="#34d399"
                  formatValue={v => `${v.toFixed(1)}×`}
                />
              </div>
            </Card>

            {/* Produkte unter Mindestbestand */}
            <Card title="Produkte unter Mindestbestand" className="col-span-2 lg:col-span-1" tooltip="Produkte deren aktueller Bestand den definierten Mindestbestand unterschreitet, sortiert nach dem kritischsten Verhältnis zuerst.">
              <div className="px-4 pt-4 pb-4">
                {belowMinStock.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">Alle Produkte über Mindestbestand</p>
                ) : (
                  <VerticalBars
                    data={belowMinStock.map(p => ({ label: p.name, value: p.current }))}
                    max={Math.max(...belowMinStock.map(p => p.min), 1)}
                    barColor="#fbbf24"
                    formatValue={v => String(v)}
                  />
                )}
              </div>
            </Card>

            {/* Ablaufende Produkte */}
            <Card title="Ablaufende Produkte" className="col-span-2 lg:col-span-1" tooltip="Produkte, deren Verfallsdatum in den nächsten 90 Tagen erreicht wird oder bereits abgelaufen ist.">
              {expiringProducts.length === 0 ? (
                <p className="text-sm text-emerald-500 font-medium text-center py-6 px-4">Alle Produkte aktuell</p>
              ) : (
                <div className="overflow-y-auto max-h-64 divide-y divide-slate-50 dark:divide-slate-700 pb-2">
                  {expiringProducts.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                        {p.lot_number && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Charge: {p.lot_number}</p>}
                      </div>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 hidden sm:block">
                        {new Date(p.expiry_date!).toLocaleDateString('de-DE')}
                      </span>
                      <span className={`text-xs font-semibold shrink-0 px-2 py-0.5 rounded-full ${
                        p.daysLeft <= 0
                          ? 'bg-red-100 text-red-600'
                          : p.daysLeft <= 30
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-yellow-100 text-yellow-600'
                      }`}>
                        {p.daysLeft <= 0 ? 'Abgelaufen' : `${p.daysLeft}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Produkte ohne Bewegung 90+ Tage — scrollable */}
            <Card title="Produkte ohne Bewegung (90+ Tage)" className="col-span-2 lg:col-span-1" tooltip="Produkte die seit mehr als 90 Tagen nicht bewegt wurden. Möglicher Hinweis auf überschüssigen oder ungenutzten Lagerbestand.">
              {noMovement90.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6 px-4">Alle Produkte wurden kürzlich bewegt</p>
              ) : (
                <div className="overflow-y-auto max-h-64 divide-y divide-slate-50 dark:divide-slate-700">
                  {noMovement90.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <p className="text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{p.name}</p>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 hidden sm:block">{p.category}</span>
                      <span className={`text-xs font-semibold shrink-0 ${p.daysSince == null ? 'text-slate-400 dark:text-slate-500' : p.daysSince > 180 ? 'text-red-500' : 'text-amber-500'}`}>
                        {p.daysSince == null ? 'Nie bewegt' : `${p.daysSince}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

          </div>
        )}

        {/* ══ PRODUKTE ════════════════════════════════════════════════════════ */}
        {dashTab === 'produkte' && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

            {/* KPI row */}
            <div className="col-span-2 lg:col-span-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
              <div className="flex divide-x divide-slate-100 dark:divide-slate-700 overflow-x-auto">
                {[
                  { icon: <ShoppingCart size={20} />, iconBg: 'bg-sky-100 dark:bg-sky-900/40', iconColor: 'text-sky-600', label: 'Wiederbestellquote', value: wiederbestellquote === null ? '–' : `${wiederbestellquote}%`, sub: 'Artikel mind. 2× bestellt', tooltip: 'Anteil der Produkte, die mindestens zweimal bestellt wurden. Zeigt welche Artikel regelmäßig nachgekauft werden.' },
                ].map((kpi, i, arr) => (
                  <div key={i} className={`flex-1 flex items-center gap-3 px-5 py-4 min-w-0 shrink-0 ${i === 0 ? 'rounded-l-2xl' : ''} ${i === arr.length - 1 ? 'rounded-r-2xl' : ''}`}>
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${kpi.iconBg}`}>
                      <span className={kpi.iconColor}>{kpi.icon}</span>
                    </div>
                    <div className="min-w-0 text-left flex-1">
                      <div className="flex items-center gap-1">
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{kpi.label}</p>
                        <CardTooltip text={kpi.tooltip} />
                      </div>
                      <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight">{kpi.value}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{kpi.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top meistverwendete */}
            <Card title="Top 10 meistverwendete Artikel" tooltip="Die 10 am häufigsten entnommenen Artikel der letzten 12 Monate, basierend auf Lagerabgängen.">
              <div className="px-4 pb-4">
                <VerticalBars
                  data={topUsed.map(d => ({ label: d.name, value: d.quantity }))}
                  max={topUsed[0]?.quantity ?? 1}
                  barColor="#38bdf8"
                  formatValue={v => `${v}×`}
                  empty="Noch keine Lagerbewegungen"
                />
              </div>
            </Card>

            {/* Top teuerste */}
            <Card title="Top 10 teuerste Artikel (Jahresausgaben)" tooltip="Die 10 Artikel mit den höchsten Gesamtausgaben, basierend auf allen erhaltenen Bestellungen.">
              <div className="px-4 pb-4">
                <VerticalBars
                  data={topExpensive.map(d => ({ label: d.name, value: d.value }))}
                  max={topExpensive[0]?.value ?? 1}
                  barColor="#fbbf24"
                  formatValue={v => `€${fmtInt(v)}`}
                  empty="Keine abgeschlossenen Bestellungen"
                />
              </div>
            </Card>

            {/* Bestellzyklen */}
            <Card title="Bestellzyklen (Ø Tage zwischen Bestellungen)" tooltip="Durchschnittlicher Abstand in Tagen zwischen Bestellungen für wiederholt bestellte Artikel. Hilft beim Erkennen regelmäßiger Bestellmuster.">
              {bestellzyklen.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6 px-4">Zu wenig Bestellhistorie</p>
              ) : (
                <div className="divide-y divide-slate-50 dark:divide-slate-700 pb-2">
                  {bestellzyklen.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <span className="text-xs font-bold text-slate-300 dark:text-slate-600 w-5 shrink-0">#{i + 1}</span>
                      <p className="text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{d.name}</p>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 mr-2">{d.orderCount}× bestellt</span>
                      <span className="text-sm font-semibold text-sky-600 shrink-0">Ø {d.avgDays}d</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Behandlungstypen-Verteilung */}
            <Card title="Nach Behandlungstyp" tooltip="Anzahl der Produkte pro Behandlungstyp.">
              <div className="px-4 pb-4">
                {treatmentTypeBreakdown.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Noch keine Behandlungstypen zugewiesen.</p>
                ) : (
                  <div className="space-y-2">
                    {treatmentTypeBreakdown.map(([type, count], i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-sm text-slate-600 dark:text-slate-300 w-32 shrink-0 truncate" title={type}>{type}</span>
                        <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-2 rounded-full bg-sky-400"
                            style={{ width: `${(count / maxTreatmentCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-8 text-right shrink-0">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Kosten nach Behandlungstyp */}
            <Card title="Ausgaben nach Behandlungstyp" tooltip="Gesamtausgaben aus erhaltenen Bestellungen, aufgeschlüsselt nach Behandlungstyp der bestellten Produkte.">
              <div className="px-4 pb-4">
                {treatmentTypeSpend.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Keine Daten – Behandlungstypen oder Bestellungen fehlen.</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {treatmentTypeSpend.map(([type, spend], i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-sm text-slate-600 dark:text-slate-300 w-32 shrink-0 truncate" title={type}>{type}</span>
                        <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                          <div className="h-2 rounded-full bg-violet-400" style={{ width: `${(spend / maxTreatmentSpend) * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-20 text-right shrink-0">€ {fmtInt(spend)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Neue Artikel pro Monat */}
            <Card title="Neue Artikel hinzugefügt (pro Monat)" className="col-span-2 lg:col-span-3" tooltip="Anzahl der neu angelegten Produkte pro Monat der letzten 12 Monate.">
              <div className="px-4 pb-4">
                <VerticalBars
                  data={newProductsByMonth.map(d => ({ label: d.label, value: d.value }))}
                  max={maxNewProducts}
                  barColor="#38bdf8"
                  formatValue={v => String(v)}
                />
              </div>
            </Card>

          </div>
        )}

      </div>

      {/* ── PDF export modal ─────────────────────────────────────────────────── */}
      {pdfOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setPdfOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPdfOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <X size={18} />
            </button>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">Finanzübersicht exportieren</h3>
            <p className="text-sm text-slate-400 dark:text-slate-400 mb-5">Zeitraum auswählen und als PDF speichern.</p>

            <div className="flex gap-2 mb-4">
              {(['month', 'year'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => {
                    setPdfPeriodType(type)
                    if (type === 'year') {
                      setPdfPeriodValue(availableYears[0] ?? String(new Date().getFullYear()))
                    } else {
                      const now = new Date()
                      setPdfPeriodValue(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
                    }
                  }}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${pdfPeriodType === type ? 'bg-sky-500 text-white border-sky-500' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'}`}
                >
                  {type === 'month' ? 'Monat' : 'Jahr'}
                </button>
              ))}
            </div>

            <select
              value={pdfPeriodValue}
              onChange={e => setPdfPeriodValue(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 mb-5 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {pdfPeriodType === 'month'
                ? months12.slice().reverse().map(m => (
                    <option key={m.key} value={m.key}>
                      {new Date(m.key + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                    </option>
                  ))
                : availableYears.length > 0
                  ? availableYears.map(y => <option key={y} value={y}>{y}</option>)
                  : <option value={String(new Date().getFullYear())}>{new Date().getFullYear()}</option>
              }
            </select>

            <button
              onClick={handleExportPDF}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <FileDown size={16} />
              Als PDF exportieren
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CardTooltip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function show() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ x: r.right, y: r.top })
  }

  useEffect(() => {
    if (!pos) return
    function hide() { setPos(null) }
    document.addEventListener('mousedown', hide)
    document.addEventListener('touchstart', hide)
    return () => { document.removeEventListener('mousedown', hide); document.removeEventListener('touchstart', hide) }
  }, [pos])

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onTouchEnd={e => { e.preventDefault(); pos ? setPos(null) : show() }}
        onClick={show}
        className="flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-slate-400 dark:hover:text-slate-400 transition-colors shrink-0"
        aria-label="Info"
      >
        <Info size={13} />
      </button>
      {pos && (
        <div
          className="fixed z-50 w-60 bg-slate-800 text-white text-xs rounded-xl px-3 py-2.5 shadow-xl pointer-events-none leading-relaxed"
          style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-100%, -100%)' }}
        >
          {text}
          <div className="absolute -bottom-1 right-3 w-2 h-2 bg-slate-800 rotate-45" />
        </div>
      )}
    </>
  )
}

function Card({ title, action, tooltip, children, className = '' }: {
  title?: string
  action?: React.ReactNode
  tooltip?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 flex flex-col ${className}`}>
      {(title || action || tooltip) && (
        <div className="flex items-start justify-between px-4 pt-4 pb-2 gap-2">
          {title && <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>}
          <div className="flex items-center gap-2 shrink-0">
            {action}
            {tooltip && <CardTooltip text={tooltip} />}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}


const STACK_COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#94a3b8']

function StackedMonthlyBars({ data, buckets, maxTotal }: {
  data: { label: string; key: string; values: Record<string, number> }[]
  buckets: string[]
  maxTotal: number
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  if (data.length === 0 || buckets.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">Keine Daten</p>
  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3">
        {buckets.map((b, i) => (
          <span key={b} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: STACK_COLORS[i % STACK_COLORS.length] }} />
            {b}
          </span>
        ))}
      </div>
      {/* Bars */}
      <div className="flex items-end gap-1" style={{ height: 140 }}>
        {data.map((month, i) => {
          const total = buckets.reduce((s, b) => s + (month.values[b] ?? 0), 0)
          const pct = total / maxTotal
          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end relative cursor-pointer"
              style={{ height: '100%' }}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              onClick={() => setActiveIdx(activeIdx === i ? null : i)}
            >
              <div className="w-full flex flex-col-reverse rounded-t-sm overflow-hidden" style={{ height: `${Math.max(2, pct * 100)}%` }}>
                {buckets.map((b, bi) => {
                  const val = month.values[b] ?? 0
                  const segPct = total > 0 ? (val / total) * 100 : 0
                  return segPct > 0 ? (
                    <div key={b} style={{ height: `${segPct}%`, background: STACK_COLORS[bi % STACK_COLORS.length] }} />
                  ) : null
                })}
              </div>
              {activeIdx === i && total > 0 && (
                <div className={`absolute bottom-full mb-1 z-20 pointer-events-none ${i === 0 ? 'left-0' : i === data.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                  <div className="bg-slate-800 text-white text-xs rounded-lg px-2.5 py-2 whitespace-nowrap shadow-lg">
                    <p className="font-semibold mb-1">{month.label}</p>
                    {buckets.filter(b => (month.values[b] ?? 0) > 0).map((b, bi) => (
                      <p key={b} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: STACK_COLORS[bi % STACK_COLORS.length] }} />
                        {b}: €{fmtInt(month.values[b] ?? 0)}
                      </p>
                    ))}
                    <p className="border-t border-slate-600 mt-1 pt-1 font-semibold">Gesamt: €{fmtInt(total)}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* X axis labels */}
      <div className="flex gap-1 mt-1 border-t border-slate-100 dark:border-slate-700 pt-1">
        {data.map((month, i) => (
          (i === 0 || i === Math.floor(data.length / 2) || i === data.length - 1) ? (
            <div key={i} className="flex-1 text-center" style={{ position: 'relative' }}>
              <span className="text-slate-400 dark:text-slate-500 leading-none" style={{ fontSize: 11 }}>{month.label}</span>
            </div>
          ) : <div key={i} className="flex-1" />
        ))}
      </div>
    </div>
  )
}

function VerticalBars({ data, max, barColor, formatValue, empty = 'Keine Daten' }: {
  data: { label: string; value: number }[]
  max: number
  barColor: string
  formatValue: (v: number) => string
  empty?: string
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  if (data.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: data.length * 60 }}>
        {/* Value labels row */}
        <div className="flex gap-1 mb-0.5" style={{ height: 18 }}>
          {data.map(({ value }, i) => (
            <div key={i} className="flex-1 text-center">
              {value > 0 && (
                <span className="text-slate-600 dark:text-slate-300 font-medium leading-none" style={{ fontSize: 11 }}>
                  {formatValue(value)}
                </span>
              )}
            </div>
          ))}
        </div>
        {/* Bars */}
        <div className="flex items-end gap-1" style={{ height: 200 }}>
          {data.map(({ label, value }, i) => (
            <div
              key={i}
              className="flex-1 h-full flex items-end relative group cursor-pointer"
              onClick={() => setActiveIdx(activeIdx === i ? null : i)}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <div
                className="w-full rounded-t-sm transition-opacity"
                style={{
                  height: `${Math.max(1, Math.round((value / max) * 100))}%`,
                  background: barColor,
                  opacity: activeIdx === null || activeIdx === i ? 1 : 0.4,
                }}
              />
              {activeIdx === i && (
                <div className={`absolute top-2 z-20 pointer-events-none ${i === 0 ? 'left-0' : i === data.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                  <div className="bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg text-center">
                    <p className="font-semibold">{label}</p>
                    <p className="text-slate-300">{formatValue(value)}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1.5 border-t border-slate-100 dark:border-slate-700 pt-1.5">
          {data.map(({ label }, i) => (
            <div key={i} className="flex-1 text-center overflow-hidden">
              <span className="text-slate-400 dark:text-slate-500 leading-none block truncate" style={{ fontSize: 11 }} title={label}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MonthlyTrendChart({ data, max }: { data: { label: string; value: number }[]; max: number }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const W = 640; const H = 100
  const PAD = { top: 28, bottom: 24, left: 8, right: 8 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const n = data.length
  if (n < 2) return <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">Keine Daten</p>

  const xs = data.map((_, i) => PAD.left + (i / (n - 1)) * chartW)
  const ys = data.map(d => PAD.top + chartH - (d.value / max) * chartH)
  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  const areaD = `${pathD} L ${xs[n - 1].toFixed(1)} ${(PAD.top + chartH).toFixed(1)} L ${xs[0].toFixed(1)} ${(PAD.top + chartH).toFixed(1)} Z`

  const peakIdx = data.reduce((best, d, i) => d.value > data[best].value ? i : best, 0)
  const tip = activeIdx !== null ? activeIdx : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#spendGrad)" />
      <path d={pathD} fill="none" stroke="#0ea5e9" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i} style={{ cursor: 'pointer' }}
          onMouseEnter={() => setActiveIdx(i)}
          onMouseLeave={() => setActiveIdx(null)}
          onClick={() => setActiveIdx(activeIdx === i ? null : i)}
        >
          {/* Larger invisible hit area */}
          <circle cx={xs[i]} cy={ys[i]} r={12} fill="transparent" />
          <circle cx={xs[i]} cy={ys[i]} r={i === peakIdx || activeIdx === i ? 5 : 2.5} fill="#0ea5e9" />
          {i === peakIdx && d.value > 0 && activeIdx !== i && (
            <text x={xs[i]} y={ys[i] - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill="#0ea5e9" fontSize="9" fontWeight="600">
              €{fmtInt(d.value)}
            </text>
          )}
          {(i === 0 || i === Math.floor(n / 2) || i === n - 1) && (
            <text x={xs[i]} y={H - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill="#94a3b8" fontSize="9">
              {d.label}
            </text>
          )}
          {tip === i && (
            <g>
              <rect
                x={Math.min(Math.max(xs[i] - 52, 0), W - 104)}
                y={ys[i] - 38}
                width={104} height={28} rx={5}
                fill="#1e293b"
              />
              <text x={Math.min(Math.max(xs[i], 52), W - 52)} y={ys[i] - 24} textAnchor="middle" fill="white" fontSize="9" fontWeight="600">
                {d.label}
              </text>
              <text x={Math.min(Math.max(xs[i], 52), W - 52)} y={ys[i] - 14} textAnchor="middle" fill="#94a3b8" fontSize="9">
                €{fmtInt(d.value)}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  )
}
