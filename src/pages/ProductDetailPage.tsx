import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PriceAlternative, Product, SupplierHistoryEntry } from '../lib/types'
import CategorySelect from '../components/CategorySelect'
import {
  ChevronLeft, Pencil, Trash2, ShoppingCart, Check, ExternalLink, X, Minus, Plus,
  Search, ChevronDown, RotateCcw,
} from 'lucide-react'

const STORAGE_LOCATIONS = [
  'Behandlungsraum 1', 'Behandlungsraum 2', 'Behandlungsraum 3',
  'Behandlungsraum 4', 'Behandlungsraum 5',
  'Steri', 'Rezeption', 'Büro', 'Radiologie', 'Keller',
]
const UNITS = ['Stück', 'Packung', 'Flasche', 'Kanister']

function stockStatus(p: Product): 'red' | 'orange' | 'green' {
  if (p.current_stock <= p.min_stock) return 'red'
  if (p.current_stock <= p.min_stock * 1.5) return 'orange'
  return 'green'
}

interface Props {
  product: Product
  onBack: () => void
  onUpdated: (p: Product) => void
  onDeleted: (id: string) => void
  onAddToCart: (productId: string, qty: number) => Promise<void>
  onCartItemAdded?: (name: string) => void
  onItemTaken?: (name: string) => void
  onNavigateToOrders?: () => void
  isModal?: boolean
  availableCategories?: string[]
  availableSuppliers?: string[]
}

export default function ProductDetailPage({ product, onBack, onUpdated, onDeleted, onAddToCart, onCartItemAdded, onItemTaken, onNavigateToOrders, isModal, availableCategories, availableSuppliers }: Props) {
  const [form, setForm] = useState(product)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const fallbackQty = Math.max(1, (product.min_stock ?? 0) - (product.current_stock ?? 0))
  const [orderQty, setOrderQty] = useState(String(fallbackQty))
  const [added, setAdded] = useState(false)
  const [taken, setTaken] = useState(false)
  const [entnehmenQty, setEntnehmenQty] = useState(1)
  const [inCart, setInCart] = useState(false)
  const [inOrdered, setInOrdered] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showDeleteSpinner, setShowDeleteSpinner] = useState(false)
  const deleteSpinnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [altState, setAltState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [altResults, setAltResults] = useState<PriceAlternative[]>([])
  const [supplierHistory, setSupplierHistory] = useState<SupplierHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const status = stockStatus(form)

  const barMax = Math.max(Number(form.current_stock) || 0, (Number(form.min_stock) || 0) * 2.5, 1)
  const fillPct = Math.min(100, ((Number(form.current_stock) || 0) / barMax) * 100)
  const thresholdPct = Math.min(99, ((Number(form.min_stock) || 0) / barMax) * 100)

  const STATUS_STYLES = {
    green:  { bar: 'bg-emerald-400', text: 'text-emerald-600', bg: 'bg-emerald-50',  border: 'border-emerald-200', label: 'Ausreichend' },
    orange: { bar: 'bg-amber-400',   text: 'text-amber-600',   bg: 'bg-amber-50',    border: 'border-amber-200',   label: 'Niedrig'     },
    red:    { bar: 'bg-red-400',     text: 'text-red-600',     bg: 'bg-red-50',      border: 'border-red-200',     label: 'Kritisch'    },
  }
  const styles = STATUS_STYLES[status]

  useEffect(() => {
    supabase.from('stock_movements').select('created_at')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
      .then(({ data }) => { if (data) setLastScan(data.created_at) })

    const since = new Date()
    since.setDate(since.getDate() - 60)
    supabase.from('stock_movements').select('quantity')
      .eq('product_id', product.id)
      .eq('type', 'scan_out')
      .gte('created_at', since.toISOString())
      .then(({ data }) => {
        if (!data || data.length === 0) return
        const total = data.reduce((s, m) => s + m.quantity, 0)
        const velocityQty = Math.ceil((total / 60) * 42)
        setOrderQty(String(Math.max(velocityQty, fallbackQty)))
      })

    if (availableCategories) {
      setCategories(availableCategories)
    } else {
      supabase.from('products').select('category').then(({ data }) => {
        if (data) setCategories([...new Set(data.map(p => p.category))].sort())
      })
    }
    if (availableSuppliers) {
      setSuppliers(availableSuppliers)
    } else {
      supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null).then(({ data }) => {
        if (data) setSuppliers([...new Set(data.map(p => p.preferred_supplier as string))].filter(Boolean).sort())
      })
    }
    fetchHistory()

    // Check cart and open orders
    ;(async () => {
      const [{ data: cartRow }, { data: orderItems }] = await Promise.all([
        supabase.from('cart_items').select('id').eq('product_id', product.id).maybeSingle(),
        supabase.from('order_items').select('order_id').eq('product_id', product.id),
      ])
      if (cartRow) { setInCart(true); return }
      if (orderItems && orderItems.length > 0) {
        const ids = orderItems.map((r: any) => r.order_id)
        const { data: open } = await supabase
          .from('orders').select('id').in('id', ids).eq('status', 'ordered').limit(1)
        setInOrdered(!!(open && open.length > 0))
      }
    })()
  }, [product.id])

  async function handleSave() {
    setSaving(true)
    const parseNum = (v: unknown) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n }
    const { data, error } = await supabase.from('products').update({
      article_number: form.article_number,
      name: form.name,
      description: form.description,
      category: form.category,
      current_stock: parseNum(form.current_stock) ?? 0,
      min_stock: parseNum(form.min_stock) ?? 0,
      unit: form.unit,
      storage_location: form.storage_location,
      expiry_date: form.expiry_date || null,
      notes: form.notes,
      last_price: parseNum(form.last_price),
      preferred_supplier: form.preferred_supplier,
      supplier_url: form.supplier_url,
      producer_url: form.producer_url,
    }).eq('id', product.id).select().single()
    setSaving(false)
    if (!error && data) {
      if (form.preferred_supplier) {
        await supabase.from('suppliers').upsert({ name: form.preferred_supplier }, { onConflict: 'name' })
      }
      onUpdated(data as Product)
      setEditing(false)
    }
  }

  async function handleDelete() {
    setConfirmDelete(false)
    deleteSpinnerTimer.current = setTimeout(() => setShowDeleteSpinner(true), 5000)
    try {
      const res = await fetch('/api/delete-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id }),
      })
      if (res.ok) {
        onDeleted(product.id)
        onBack()
      }
    } finally {
      if (deleteSpinnerTimer.current) clearTimeout(deleteSpinnerTimer.current)
      setShowDeleteSpinner(false)
    }
  }

  async function handleAddToCart() {
    await onAddToCart(product.id, parseInt(orderQty) || 1)
    if (onCartItemAdded) {
      onCartItemAdded(product.name)
    } else {
      setInCart(true)
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    }
  }

  async function handleTake() {
    const qty = Math.min(entnehmenQty, Number(form.current_stock))
    if (qty <= 0) return
    const { data: { user } } = await supabase.auth.getUser()
    const res = await fetch('/api/take-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: qty, userId: user?.id }),
    })
    if (!res.ok) return
    const { newStock } = await res.json()
    if (onItemTaken) {
      onItemTaken(product.name)
    } else {
      setForm(f => ({ ...f, current_stock: newStock }))
      setEntnehmenQty(1)
      setTaken(true)
      setTimeout(() => setTaken(false), 2000)
    }
  }

  async function fetchHistory() {
    const { data } = await supabase
      .from('product_supplier_history')
      .select('*')
      .eq('product_id', product.id)
      .order('set_at', { ascending: false })
    setSupplierHistory((data ?? []) as SupplierHistoryEntry[])
  }

  async function searchAlternatives() {
    setAltState('loading')
    setAltResults([])
    try {
      const res = await fetch('/api/find-alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: product.name, brand: product.preferred_supplier }),
      })
      const data = await res.json()
      setAltResults(data.results ?? [])
    } catch { /* network error */ }
    setAltState('done')
  }

  async function saveCurrentToHistory(source: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!form.preferred_supplier && !form.supplier_url && form.last_price == null) return
    await supabase.from('product_supplier_history').insert({
      product_id: product.id,
      supplier_name: form.preferred_supplier,
      supplier_url: form.supplier_url,
      price: form.last_price,
      set_by: user?.id ?? null,
      source,
    })
  }

  async function setAsDefault(alt: PriceAlternative) {
    await saveCurrentToHistory('auto')
    const { data } = await supabase.from('products').update({
      preferred_supplier: alt.domain,
      supplier_url: alt.url,
      last_price: alt.price,
    }).eq('id', product.id).select().single()
    if (data) { onUpdated(data as Product); setForm(data as Product) }
    fetchHistory()
  }

  async function restoreSupplier(entry: SupplierHistoryEntry) {
    await saveCurrentToHistory('manual')
    const { data } = await supabase.from('products').update({
      preferred_supplier: entry.supplier_name,
      supplier_url: entry.supplier_url,
      last_price: entry.price,
    }).eq('id', product.id).select().single()
    if (data) { onUpdated(data as Product); setForm(data as Product) }
    fetchHistory()
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500'

  function editField(label: string, key: keyof Product, type: 'text' | 'number' | 'url' | 'select' | 'unit' | 'textarea' = 'text') {
    const val = form[key] as string | number | null
    return (
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
        {type === 'select' ? (
          <select value={(val as string) ?? ''}
            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
            className={inputCls}>
            <option value="">— Kein Lagerort —</option>
            {STORAGE_LOCATIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : type === 'unit' ? (
          <select value={(val as string) ?? ''}
            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
            className={inputCls}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        ) : type === 'textarea' ? (
          <textarea value={String(val ?? '')} rows={3}
            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
            className={`${inputCls} resize-none`} />
        ) : (
          <input
            type={type === 'number' ? 'text' : type}
            inputMode={type === 'number' ? 'decimal' : undefined}
            pattern={type === 'number' ? '[0-9.,]*' : undefined}
            value={String(val ?? '')}
            onChange={e => setForm(p => ({
              ...p,
              [key]: type === 'number' ? (e.target.value as unknown as number) : e.target.value,
            }))}
            className={inputCls}
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50 overflow-x-hidden">
      {/* Slow operation spinner */}
      {showDeleteSpinner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
          <div className="w-14 h-14 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {/* Sub-header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        {/* Back button — non-modal only */}
        {!isModal && (
          <button
            onClick={editing ? () => { setForm(product); setEditing(false) } : onBack}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 p-1 -ml-1 shrink-0"
          >
            <ChevronLeft size={16} />
            Zurück
          </button>
        )}

        <h1 className="font-semibold text-slate-800 truncate flex-1">{form.name}</h1>

        {/* Edit/delete in header — non-modal only */}
        {!editing && !isModal && (
          <>
            <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-sky-600 p-1.5 shrink-0">
              <Pencil size={16} />
            </button>
            <button
              onClick={() => !inCart && !inOrdered && setConfirmDelete(true)}
              disabled={inCart || inOrdered}
              title={inCart ? 'Im Warenkorb — kann nicht gelöscht werden' : inOrdered ? 'In offener Bestellung — kann nicht gelöscht werden' : undefined}
              className={`p-1.5 shrink-0 transition-colors ${inCart || inOrdered ? 'text-slate-200 cursor-not-allowed' : 'text-slate-300 hover:text-red-400'}`}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}

        {/* Close button — modal only */}
        {isModal && (
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4"
        style={{ paddingBottom: editing && !isModal ? '80px' : undefined }}>

        {/* ── Stock card ── */}
        <div className={`rounded-2xl border overflow-hidden ${styles.border}`}>
          <div className={`px-4 py-3 ${styles.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-3xl font-bold ${styles.text}`}>
                {form.current_stock} <span className="text-sm font-normal text-slate-400">{form.unit}</span>
              </p>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-white/70 ${styles.text}`}>
                {styles.label}
              </span>
            </div>
            <div className="relative h-2 bg-white/60 rounded-full overflow-hidden">
              <div className={`absolute left-0 top-0 h-full rounded-full ${styles.bar}`} style={{ width: `${fillPct}%` }} />
              <div className="absolute top-0 h-full w-[3px] bg-slate-500 opacity-40" style={{ left: `${thresholdPct}%` }} />
            </div>
            {editing && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {editField('Aktuell', 'current_stock', 'number')}
                {editField('Meldebestand', 'min_stock', 'number')}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
                  <select value={form.unit ?? ''} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                    className={inputCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Order + take actions — always visible when not editing */}
          {!editing && (
            <div className={`border-t ${styles.border} bg-white`}>

              {/* ── Bestellen ── */}
              <div className="px-4 pt-4 pb-3">
                <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${(inCart || inOrdered) ? 'text-slate-300' : status === 'red' ? 'text-red-600' : status === 'orange' ? 'text-amber-600' : 'text-slate-500'}`}>
                  Bestellen
                </p>
                {(inCart || inOrdered) ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                      <ShoppingCart size={14} className="text-sky-500" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">
                        {inCart ? 'Artikel bereits im Warenkorb' : 'Artikel bereits in Bestellung'}
                        {onNavigateToOrders && (
                          <button onClick={onNavigateToOrders} className="ml-2 text-sky-500 hover:text-sky-600 hover:underline transition-colors">
                            {inCart ? 'Zum Warenkorb →' : 'Zur Bestellung →'}
                          </button>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden shrink-0">
                      <button onClick={() => setOrderQty(q => String(Math.max(1, (parseInt(q) || 1) - 1)))}
                        className="w-9 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors">
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm font-semibold text-slate-800 select-none">{orderQty}</span>
                      <button onClick={() => setOrderQty(q => String((parseInt(q) || 0) + 1))}
                        className="w-9 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors">
                        <Plus size={14} />
                      </button>
                    </div>
                    {form.last_price != null ? (
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400">€ {Number(form.last_price).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {form.unit}</p>
                        <p className="text-sm font-bold text-slate-800">€ {((parseInt(orderQty) || 0) * Number(form.last_price)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    ) : <div className="flex-1" />}
                    <button onClick={handleAddToCart}
                      className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                        added ? 'bg-emerald-100 text-emerald-600' : 'bg-sky-500 hover:bg-sky-600 text-white'
                      }`}>
                      {added ? <Check size={20} /> : <ShoppingCart size={20} />}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Entnehmen (only when in stock) ── */}
              {Number(form.current_stock) > 0 && <>
              <div className="border-t border-slate-100" />
              <div className="px-4 pt-3 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Entnehmen</p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden shrink-0">
                    <button onClick={() => setEntnehmenQty(q => Math.max(1, q - 1))}
                      disabled={entnehmenQty <= 1}
                      className="w-9 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                      <Minus size={14} />
                    </button>
                    <span className="w-10 text-center text-sm font-semibold text-slate-800 select-none">{entnehmenQty}</span>
                    <button onClick={() => setEntnehmenQty(q => Math.min(Number(form.current_stock), q + 1))}
                      disabled={entnehmenQty >= Number(form.current_stock)}
                      className="w-9 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-colors">
                      <Plus size={14} />
                    </button>
                  </div>
                  <p className="flex-1 text-xs text-slate-400">max. {form.current_stock} {form.unit}</p>
                  <button onClick={handleTake}
                    disabled={Number(form.current_stock) <= 0}
                    className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                      taken ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-700'
                    }`}>
                    {taken ? <Check size={20} /> : <Minus size={20} />}
                  </button>
                </div>
              </div>
              </>}

            </div>
          )}
        </div>

        {/* ── Info fields ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          {editing ? (
            <div className="space-y-3">
              {editField('Name', 'name')}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kategorie</label>
                <CategorySelect value={form.category ?? ''} onChange={v => setForm(p => ({ ...p, category: v }))} categories={categories} />
              </div>
              {editField('Artikelnummer', 'article_number')}
              {editField('Stückpreis (€)', 'last_price', 'number')}
              {editField('Lagerort', 'storage_location', 'select')}
              {editField('Beschreibung', 'notes', 'textarea')}
              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Lieferant</label>
                  <CategorySelect
                    value={form.preferred_supplier ?? ''}
                    onChange={v => setForm(p => ({ ...p, preferred_supplier: v }))}
                    categories={suppliers}
                    placeholder="Lieferant suchen…"
                    newLabel="als neuer Lieferant"
                  />
                </div>
                {editField('Bestellwebsite', 'supplier_url', 'url')}
                {editField('Hersteller-Website', 'producer_url', 'url')}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Primary info grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Info label="Kategorie" value={form.category} />
                <Info label="Einheit" value={form.unit} />
                {form.article_number ? <Info label="Artikelnummer" value={form.article_number} /> : null}
                {form.last_price != null ? <Info label="Stückpreis" value={`€ ${Number(form.last_price).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} /> : null}
                {form.storage_location ? <Info label="Lagerort" value={form.storage_location} /> : null}
                {lastScan ? <Info label="Zuletzt geprüft" value={new Date(lastScan).toLocaleDateString('de-DE')} /> : null}
              </div>

              {(form.notes || form.description) ? <Info label="Beschreibung" value={(form.notes || form.description)!} /> : null}

              {(form.preferred_supplier || form.supplier_url || form.producer_url) && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  {form.preferred_supplier ? <Info label="Lieferant" value={form.preferred_supplier} /> : null}
                  {form.supplier_url ? (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Bestellwebsite</p>
                      <a href={form.supplier_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-sky-600 hover:underline break-all">
                        <ExternalLink size={12} /> {form.supplier_url}
                      </a>
                    </div>
                  ) : null}
                  {form.producer_url ? (
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Hersteller-Website</p>
                      <a href={form.producer_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-sky-600 hover:underline break-all">
                        <ExternalLink size={12} /> {form.producer_url}
                      </a>
                    </div>
                  ) : null}
                </div>
              )}

              {/* ── Price alternatives ── */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preisvergleich</p>
                  <button
                    onClick={searchAlternatives}
                    disabled={altState === 'loading'}
                    className="flex items-center gap-1.5 text-xs font-medium text-sky-600 hover:text-sky-700 disabled:opacity-40 transition-colors"
                  >
                    {altState === 'loading'
                      ? <span className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin inline-block" />
                      : <Search size={12} />
                    }
                    {altState === 'idle' ? 'Suchen' : altState === 'loading' ? 'Suche läuft…' : 'Erneut suchen'}
                  </button>
                </div>

                {altState === 'done' && altResults.length === 0 && (
                  <p className="text-sm text-slate-400 py-1">Keine Ergebnisse gefunden</p>
                )}

                {altResults.map(alt => {
                  const savings = form.last_price != null && form.last_price > 0
                    ? ((form.last_price - alt.price) / form.last_price) * 100
                    : null
                  const isCheaper = savings != null && savings > 0.5
                  const isCurrentSupplier = form.supplier_url?.includes(alt.domain)
                  return (
                    <div key={alt.url} className="flex items-center gap-2 py-2.5 border-b border-slate-50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">{alt.domain}</p>
                        {alt.name && <p className="text-xs text-slate-400 truncate mt-0.5">{alt.name}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-slate-800">
                          € {alt.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        {savings != null && (
                          <span className={`text-xs font-medium ${isCheaper ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {isCheaper ? `−${Math.round(savings)}%` : savings < -0.5 ? `+${Math.round(-savings)}%` : '≈ gleich'}
                          </span>
                        )}
                      </div>
                      <a href={alt.url} target="_blank" rel="noopener noreferrer"
                        className="text-slate-300 hover:text-sky-500 p-1 transition-colors shrink-0">
                        <ExternalLink size={14} />
                      </a>
                      {!isCurrentSupplier && (
                        <button
                          onClick={() => setAsDefault(alt)}
                          className="text-xs font-medium bg-sky-50 hover:bg-sky-100 text-sky-600 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          Standard
                        </button>
                      )}
                      {isCurrentSupplier && (
                        <span className="text-xs text-slate-400 px-2.5 py-1.5 whitespace-nowrap shrink-0">Aktuell</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ── Supplier history ── */}
              {supplierHistory.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <button
                    onClick={() => setHistoryOpen(o => !o)}
                    className="flex items-center gap-2 w-full text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Verlauf ({supplierHistory.length})
                    <ChevronDown size={12} className={`ml-auto transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {historyOpen && (
                    <div className="mt-3 space-y-1">
                      {supplierHistory.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 py-2 border-b border-slate-50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700 font-medium truncate">{entry.supplier_name ?? '—'}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {entry.price != null
                                ? `€ ${entry.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · `
                                : ''}
                              {new Date(entry.set_at).toLocaleDateString('de-DE')}
                            </p>
                          </div>
                          {entry.supplier_url && (
                            <a href={entry.supplier_url} target="_blank" rel="noopener noreferrer"
                              className="text-slate-300 hover:text-sky-500 p-1 transition-colors shrink-0">
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <button
                            onClick={() => restoreSupplier(entry)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-sky-600 font-medium px-2.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors whitespace-nowrap shrink-0"
                          >
                            <RotateCcw size={11} /> Wiederherstellen
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Edit / Delete buttons — modal only, shown below details when not editing */}
        {isModal && !editing && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 rounded-xl py-3 text-sm font-medium text-slate-700 transition-colors"
            >
              <Pencil size={15} />
              Bearbeiten
            </button>
            <div className="flex-1 flex flex-col gap-1">
              <button
                onClick={() => !inCart && !inOrdered && setConfirmDelete(true)}
                disabled={inCart || inOrdered}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors ${
                  inCart || inOrdered
                    ? 'bg-red-200 text-red-300 cursor-not-allowed'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                <Trash2 size={15} />
                Löschen
              </button>
              {(inCart || inOrdered) && (
                <p className="text-xs text-slate-400 text-center">
                  {inCart ? 'Aktuell im Warenkorb' : 'In offener Bestellung'}
                </p>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Edit footer */}
      {editing && (
        <div className={`${isModal ? '' : 'fixed bottom-0 left-0 right-0'} bg-white border-t border-slate-100 px-4 py-4 flex gap-3 z-20`}>
          <button onClick={() => { setForm(product); setEditing(false) }}
            className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600">
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium">
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-slide-in-up">
            <h3 className="font-semibold text-slate-800 text-lg mb-1">Artikel löschen?</h3>
            <p className="text-sm text-slate-500 mb-5">{product.name} wird dauerhaft gelöscht.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={handleDelete}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  )
}
