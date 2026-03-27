import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import type { Product, SupplierHistoryEntry } from '../lib/types'
import CategorySelect from '../components/CategorySelect'
import Toast from '../components/Toast'
import BarcodeScanModal from '../components/BarcodeScanModal'
import {
  ChevronLeft, Pencil, Trash2, ShoppingCart, Check, ExternalLink, X, Minus, Plus,
  ChevronDown, RotateCcw, Camera,
} from 'lucide-react'

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
]
const BARCODE_SCAN_DIV = 'product-detail-barcode-scanner'

const STORAGE_LOCATIONS = [
  'Behandlungsraum 1', 'Behandlungsraum 2', 'Behandlungsraum 3',
  'Behandlungsraum 4', 'Behandlungsraum 5',
  'Steri', 'Rezeption', 'Büro', 'Radiologie', 'Keller',
]
const UNITS = ['Stück', 'Packung', 'Flasche', 'Kanister']
const TREATMENT_TYPE_OPTIONS = [
  'Prophylaxe', 'Chirurgie', 'Implantologie', 'Prothetik',
  'Konservierend', 'Kieferorthopädie', 'Allgemein',
]

function stockStatus(p: Product): 'red' | 'orange' | 'green' {
  const cur = parseFloat(String(p.current_stock))
  const min = parseFloat(String(p.min_stock))
  if (isNaN(cur) || isNaN(min)) return 'green'
  if (cur <= min) return 'red'
  if (cur <= min * 1.5) return 'orange'
  return 'green'
}

function expiryStatus(dateStr: string | null | undefined): 'expired' | 'soon' | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(dateStr)
  exp.setHours(0, 0, 0, 0)
  if (exp <= today) return 'expired'
  const thirtyDays = new Date(today)
  thirtyDays.setDate(today.getDate() + 30)
  if (exp <= thirtyDays) return 'soon'
  return null
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
  availableBrands?: string[]
}

export default function ProductDetailPage({ product, onBack, onUpdated, onDeleted, onAddToCart, onCartItemAdded, onItemTaken, onNavigateToOrders, isModal, availableCategories, availableSuppliers, availableBrands }: Props) {
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
  const [brands, setBrands] = useState<string[]>([])
const [supplierHistory, setSupplierHistory] = useState<SupplierHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  const status = stockStatus(form)

  const barMax = Math.max(Number(form.current_stock) || 0, (Number(form.min_stock) || 0) * 2.5, 1)
  const fillPct = Math.min(100, ((Number(form.current_stock) || 0) / barMax) * 100)
  const thresholdPct = Math.min(99, ((Number(form.min_stock) || 0) / barMax) * 100)

  const STATUS_STYLES = {
    green:  { bar: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20',  border: 'border-emerald-200 dark:border-emerald-800', label: 'Ausreichend' },
    orange: { bar: 'bg-amber-400',   text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20',      border: 'border-amber-200 dark:border-amber-800',     label: 'Niedrig'     },
    red:    { bar: 'bg-red-400',     text: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20',          border: 'border-red-200 dark:border-red-800',         label: 'Kritisch'    },
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
      Promise.all([
        supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null),
        supabase.from('suppliers').select('name'),
      ]).then(([{ data: prodData }, { data: supData }]) => {
        const fromProducts = (prodData ?? []).map(p => p.preferred_supplier as string)
        const fromSuppliers = (supData ?? []).map(s => s.name as string)
        setSuppliers([...new Set([...fromProducts, ...fromSuppliers])].filter(Boolean).sort())
      })
    }
    if (availableBrands) {
      setBrands(availableBrands)
    } else {
      Promise.all([
        supabase.from('products').select('brand').not('brand', 'is', null),
        supabase.from('brands').select('name'),
      ]).then(([{ data: prodData }, { data: brandData }]) => {
        const fromProducts = (prodData ?? []).map(p => p.brand as string)
        const fromBrands = (brandData ?? []).map(b => b.name as string)
        setBrands([...new Set([...fromProducts, ...fromBrands])].filter(Boolean).sort())
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
      barcode: form.barcode || null,
      name: form.name,
      description: form.description,
      category: form.category,
      current_stock: parseNum(form.current_stock) ?? 0,
      min_stock: parseNum(form.min_stock) ?? 0,
      unit: form.unit,
      storage_location: form.storage_location,
      expiry_date: form.expiry_date || null,
      lot_number: form.lot_number || null,
      treatment_types: form.treatment_types ?? [],
      notes: form.notes,
      last_price: parseNum(form.last_price),
      preferred_supplier: form.preferred_supplier,
      supplier_url: form.supplier_url,
      brand: form.brand,
    }).eq('id', product.id).select().single()
    setSaving(false)
    if (!error && data) {
      if (form.preferred_supplier) {
        await supabase.from('suppliers').upsert({ name: form.preferred_supplier }, { onConflict: 'name' })
      }
      onUpdated(data as Product)
      setEditing(false)
      setToast('Änderungen gespeichert')
    } else if (error) {
      setToast(`Fehler: ${error.message}`)
    }
  }

  async function handleDelete() {
    setConfirmDelete(false)
    deleteSpinnerTimer.current = setTimeout(() => setShowDeleteSpinner(true), 5000)
    try {
      const related = await Promise.all([
        supabase.from('stock_movements').delete().eq('product_id', product.id),
        supabase.from('cart_items').delete().eq('product_id', product.id),
        supabase.from('order_items').delete().eq('product_id', product.id),
        supabase.from('product_supplier_history').delete().eq('product_id', product.id),
      ])
      const relatedError = related.find(r => r.error)?.error
      if (relatedError) {
        alert(`Fehler beim Löschen verknüpfter Daten: ${relatedError.message}`)
        return
      }
      const { data: deleted, error } = await supabase.from('products').delete().eq('id', product.id).select()
      if (error) {
        alert(`Fehler: ${error.message}`)
        return
      }
      if (!deleted || deleted.length === 0) {
        alert('Artikel konnte nicht gelöscht werden (möglicherweise fehlende Berechtigung).')
        return
      }
      onDeleted(product.id)
      onBack()
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
      .select('id, product_id, supplier_name, supplier_url, price, set_at, set_by, source')
      .eq('product_id', product.id)
      .order('set_at', { ascending: false })
    setSupplierHistory((data ?? []) as SupplierHistoryEntry[])
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

  async function startBarcodeScanner() {
    flushSync(() => setScanning(true))
    const scanner = new Html5Qrcode(BARCODE_SCAN_DIV, { formatsToSupport: SCAN_FORMATS, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } })
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 25, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.85, height: Math.min(w, h) * 0.85 }) },
        async (raw) => {
          await scanner.stop()
          scanner.clear()
          scannerRef.current = null
          setScanning(false)
          const clean = raw.replace(/^\][A-Za-z][0-9]/, '').replace(/[^\x20-\x7E]/g, '').trim()
          const gtin = clean.match(/^01(\d{14})/)
          const raw14 = gtin ? gtin[1] : clean
          const barcode = raw14.length === 14 && raw14.startsWith('0') ? raw14.slice(1) : raw14
          setForm(p => ({ ...p, barcode }))
        },
        () => {}
      )
    } catch { setScanning(false) }
  }

  function stopBarcodeScanner() {
    const s = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    if (s?.isScanning) s.stop().then(() => s.clear()).catch(() => {})
    else s?.clear()
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  const selectCls = `${inputCls} pr-8 appearance-none`
  function SelectWrapper({ children }: { children: React.ReactNode }) {
    return (
      <div className="relative">
        {children}
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>
    )
  }

  function editField(label: string, key: keyof Product, type: 'text' | 'number' | 'url' | 'select' | 'unit' | 'textarea' = 'text') {
    const val = form[key] as string | number | null
    return (
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</label>
        {type === 'select' ? (
          <SelectWrapper>
            <select value={(val as string) ?? ''}
              onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
              className={selectCls}>
              <option value="">— Kein Lagerort —</option>
              {STORAGE_LOCATIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </SelectWrapper>
        ) : type === 'unit' ? (
          <SelectWrapper>
            <select value={(val as string) ?? ''}
              onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
              className={selectCls}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </SelectWrapper>
        ) : type === 'textarea' ? (
          <textarea value={String(val ?? '')} rows={3}
            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
            className={`${inputCls} resize-none`} />
        ) : (
          <input
            type={type === 'number' ? 'text' : type}
            inputMode={type === 'number' ? 'decimal' : undefined}
            pattern={type === 'number' ? '[0-9.,]*' : undefined}
            value={type === 'number' ? String(val ?? '').replace('.', ',') : String(val ?? '')}
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
    <div className={`bg-slate-50 dark:bg-slate-900 overflow-x-hidden ${isModal ? 'flex flex-col flex-1 min-h-0' : 'min-h-full'}`}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {/* Slow operation spinner */}
      {showDeleteSpinner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
          <div className="w-14 h-14 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {/* Sub-header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        {/* Back button — non-modal only */}
        {!isModal && (
          <button
            onClick={editing ? () => { setForm(product); setEditing(false) } : onBack}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 -ml-1 shrink-0"
          >
            <ChevronLeft size={16} />
            Zurück
          </button>
        )}

        <h1 className="font-semibold text-slate-800 dark:text-slate-100 truncate flex-1">{form.name}</h1>

        {/* Edit/delete in header — non-modal only */}
        {!editing && !isModal && (
          <>
            <button onClick={() => setEditing(true)} className="text-slate-400 dark:text-slate-500 hover:text-sky-600 p-1.5 shrink-0">
              <Pencil size={16} />
            </button>
            <button
              onClick={() => !inCart && !inOrdered && setConfirmDelete(true)}
              disabled={inCart || inOrdered}
              title={inCart ? 'Im Warenkorb — kann nicht gelöscht werden' : inOrdered ? 'In offener Bestellung — kann nicht gelöscht werden' : undefined}
              className={`p-1.5 shrink-0 transition-colors ${inCart || inOrdered ? 'text-slate-200 dark:text-slate-700 cursor-not-allowed' : 'text-slate-300 dark:text-slate-600 hover:text-red-400'}`}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}

        {/* Close button — modal only */}
        {isModal && (
          <button
            onClick={onBack}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className={isModal ? 'flex-1 overflow-y-auto min-h-0' : ''}>
      <div className="max-w-2xl mx-auto p-4 space-y-4"
        style={{ paddingBottom: editing && !isModal ? '80px' : undefined }}>

        {/* ── Stock card ── */}
        <div className={`rounded-2xl border overflow-hidden ${styles.border}`}>
          <div className={`px-4 py-3 ${styles.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-3xl font-bold ${styles.text}`}>
                {form.current_stock} <span className="text-sm font-normal text-slate-400 dark:text-slate-500">{form.unit}</span>
              </p>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-white/70 dark:bg-black/30 ${styles.text}`}>
                {styles.label}
              </span>
            </div>
            <div className="relative h-2 bg-white/60 dark:bg-white/10 rounded-full overflow-hidden">
              <div className={`absolute left-0 top-0 h-full rounded-full ${styles.bar}`} style={{ width: `${fillPct}%` }} />
              <div className="absolute top-0 h-full w-[3px] bg-slate-500 opacity-40" style={{ left: `${thresholdPct}%` }} />
            </div>
            {editing && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {editField('Aktuell', 'current_stock', 'number')}
                {editField('Meldebestand', 'min_stock', 'number')}
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Einheit</label>
                  <SelectWrapper>
                    <select value={form.unit ?? ''} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                      className={selectCls}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </SelectWrapper>
                </div>
              </div>
            )}
          </div>

          {/* Order + take actions — always visible when not editing */}
          {!editing && (
            <div className={`border-t ${styles.border} bg-white dark:bg-slate-900 dark:border-slate-700`}>

              {/* ── Bestellen ── */}
              <div className="px-4 pt-4 pb-3">
                <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${(inCart || inOrdered) ? 'text-slate-300 dark:text-slate-600' : status === 'red' ? 'text-red-600' : status === 'orange' ? 'text-amber-600' : 'text-slate-500 dark:text-slate-400'}`}>
                  Bestellen
                </p>
                {(inCart || inOrdered) ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                      <ShoppingCart size={14} className="text-sky-500" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-400 dark:text-slate-500">
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
                    <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shrink-0">
                      <button onClick={() => setOrderQty(q => String(Math.max(1, (parseInt(q) || 1) - 1)))}
                        className="w-11 h-11 flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-sm font-semibold text-slate-800 dark:text-slate-100 select-none">{orderQty}</span>
                      <button onClick={() => setOrderQty(q => String((parseInt(q) || 0) + 1))}
                        className="w-11 h-11 flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <Plus size={14} />
                      </button>
                    </div>
                    {form.last_price != null ? (
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400 dark:text-slate-500">€ {parseFloat(String(form.last_price).replace(',', '.')).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {form.unit}</p>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">€ {((parseInt(orderQty) || 0) * parseFloat(String(form.last_price).replace(',', '.'))).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
              <div className="border-t border-slate-100 dark:border-slate-700" />
              <div className="px-4 pt-3 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">Entnehmen</p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shrink-0">
                    <button onClick={() => setEntnehmenQty(q => Math.max(1, q - 1))}
                      disabled={entnehmenQty <= 1}
                      className="w-9 h-10 flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors">
                      <Minus size={14} />
                    </button>
                    <span className="w-10 text-center text-sm font-semibold text-slate-800 dark:text-slate-100 select-none">{entnehmenQty}</span>
                    <button onClick={() => setEntnehmenQty(q => Math.min(Number(form.current_stock), q + 1))}
                      disabled={entnehmenQty >= Number(form.current_stock)}
                      className="w-9 h-10 flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors">
                      <Plus size={14} />
                    </button>
                  </div>
                  <p className="flex-1 text-xs text-slate-400 dark:text-slate-500">max. {form.current_stock} {form.unit}</p>
                  <button onClick={handleTake}
                    disabled={Number(form.current_stock) <= 0}
                    className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                      taken ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30 text-slate-700 dark:text-slate-200'
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
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
          {editing ? (
            <div className="space-y-3">
              {editField('Name', 'name')}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Kategorie</label>
                <CategorySelect value={form.category ?? ''} onChange={v => setForm(p => ({ ...p, category: v }))} categories={categories} />
              </div>
              {editField('Artikelnummer', 'article_number')}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Barcode</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.barcode ?? ''}
                    onChange={e => setForm(p => ({ ...p, barcode: e.target.value || null }))}
                    placeholder="Barcode eingeben oder scannen"
                    className={inputCls}
                  />
                  <button type="button" onClick={startBarcodeScanner} disabled={scanning}
                    className="shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-sm font-medium transition-colors">
                    <Camera size={16} />
                  </button>
                </div>
                {scanning && <BarcodeScanModal divId={BARCODE_SCAN_DIV} onClose={stopBarcodeScanner} scannerRef={scannerRef} onManualEntry={code => { stopBarcodeScanner(); setForm(p => ({ ...p, barcode: code })) }} />}
              </div>
              {editField('Stückpreis (€)', 'last_price', 'number')}
              {editField('Lagerort', 'storage_location', 'select')}
              {editField('Beschreibung', 'notes', 'textarea')}
              {/* Verfallsdatum */}
              <div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Verfallsdatum
                  {(() => {
                    const st = expiryStatus(form.expiry_date)
                    if (st === 'expired') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Abgelaufen</span>
                    if (st === 'soon') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">Bald ablaufend</span>
                    return null
                  })()}
                </label>
                <input
                  type="date"
                  value={form.expiry_date ?? ''}
                  onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value || null }))}
                  className={`${inputCls} dark:[color-scheme:dark]`}
                />
              </div>
              {/* Chargennummer */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Chargennummer</label>
                <input
                  type="text"
                  value={form.lot_number ?? ''}
                  placeholder="z.B. LOT-2024-001"
                  onChange={e => setForm(p => ({ ...p, lot_number: e.target.value || null }))}
                  className={inputCls}
                />
              </div>
              {/* Behandlungstypen */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
                  Behandlungstypen <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {TREATMENT_TYPE_OPTIONS.map(opt => {
                    const selected = (form.treatment_types ?? []).includes(opt)
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setForm(p => {
                          const current = p.treatment_types ?? []
                          return {
                            ...p,
                            treatment_types: selected
                              ? current.filter(t => t !== opt)
                              : [...current, opt],
                          }
                        })}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                          selected
                            ? 'bg-sky-500 border-sky-500 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Lieferant</label>
                  <CategorySelect
                    value={form.preferred_supplier ?? ''}
                    onChange={v => setForm(p => ({ ...p, preferred_supplier: v }))}
                    categories={suppliers}
                    placeholder="Lieferant suchen…"
                    newLabel="als neuer Lieferant"
                  />
                </div>
                {editField('Bestellwebsite', 'supplier_url', 'url')}
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Hersteller</label>
                  <CategorySelect
                    value={form.brand ?? ''}
                    onChange={v => setForm(p => ({ ...p, brand: v || null }))}
                    categories={brands}
                    placeholder="Hersteller suchen…"
                    newLabel="als neuer Hersteller"
                    emptyLabel="Keine Hersteller vorhanden"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Primary info grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Info label="Kategorie" value={form.category} />
                <Info label="Einheit" value={form.unit} />
                {form.article_number ? <Info label="Artikelnummer" value={form.article_number} /> : null}
                {form.last_price != null ? <Info label="Stückpreis" value={`€ ${parseFloat(String(form.last_price).replace(',', '.')).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} /> : null}
                {form.storage_location ? <Info label="Lagerort" value={form.storage_location} /> : null}
                {lastScan ? <Info label="Zuletzt geprüft" value={new Date(lastScan).toLocaleDateString('de-DE')} /> : null}
              </div>

              {(form.notes || form.description) ? <Info label="Beschreibung" value={(form.notes || form.description)!} /> : null}

              {/* Verfallsdatum / Chargennummer / Behandlungstypen */}
              {(form.expiry_date || form.lot_number || (form.treatment_types && form.treatment_types.length > 0)) && (
                <div className="border-t border-slate-100 dark:border-slate-700 pt-4 space-y-3">
                  {form.expiry_date && (() => {
                    const st = expiryStatus(form.expiry_date)
                    const formatted = new Date(form.expiry_date + 'T00:00:00').toLocaleDateString('de-DE')
                    return (
                      <div>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Verfallsdatum</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-slate-800 dark:text-slate-100">{formatted}</p>
                          {st === 'expired' && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Abgelaufen</span>
                          )}
                          {st === 'soon' && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">Bald ablaufend</span>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  {form.lot_number && (
                    <Info label="Chargennummer" value={form.lot_number} />
                  )}
                  {form.treatment_types && form.treatment_types.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">Behandlungstypen</p>
                      <div className="flex flex-wrap gap-1.5">
                        {form.treatment_types.map(t => (
                          <span key={t} className="text-xs font-medium px-3 py-1 rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-100 dark:border-slate-700 pt-4 space-y-3">
                <Info label="Lieferant" value={form.preferred_supplier ?? '—'} />
                {form.brand ? <Info label="Hersteller" value={form.brand} /> : null}
                {form.supplier_url ? (
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">Bestellwebsite</p>
                    <a href={form.supplier_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-sky-600 hover:underline break-all">
                      {form.supplier_url}
                    </a>
                  </div>
                ) : null}
              </div>

{/* ── Supplier history ── */}
              {supplierHistory.length > 0 && (
                <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                  <button
                    onClick={() => setHistoryOpen(o => !o)}
                    className="flex items-center gap-2 w-full text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    Verlauf ({supplierHistory.length})
                    <ChevronDown size={12} className={`ml-auto transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {historyOpen && (
                    <div className="mt-3 space-y-1">
                      {supplierHistory.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 py-2 border-b border-slate-50 dark:border-slate-700 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700 dark:text-slate-200 font-medium truncate">{entry.supplier_name ?? '—'}</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                              {entry.price != null
                                ? `€ ${entry.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · `
                                : ''}
                              {new Date(entry.set_at).toLocaleDateString('de-DE')}
                            </p>
                          </div>
                          {entry.supplier_url && (
                            <a href={entry.supplier_url} target="_blank" rel="noopener noreferrer"
                              className="text-slate-300 dark:text-slate-600 hover:text-sky-500 p-1 transition-colors shrink-0">
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <button
                            onClick={() => restoreSupplier(entry)}
                            className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 font-medium px-2.5 py-1.5 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors whitespace-nowrap shrink-0"
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

      </div>
      </div>{/* end scroll wrapper */}

      {/* Modal footer — sticky at bottom */}
      {isModal && (
        <div className="bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-4 py-4 flex gap-3 shrink-0">
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Pencil size={15} />
                Bearbeiten
              </button>
              <button
                onClick={() => !inCart && !inOrdered && setConfirmDelete(true)}
                disabled={inCart || inOrdered}
                title={inCart ? 'Aktuell im Warenkorb' : inOrdered ? 'In offener Bestellung' : undefined}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors ${
                  inCart || inOrdered
                    ? 'bg-red-200 text-red-300 cursor-not-allowed'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                <Trash2 size={15} />
                Löschen
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { stopBarcodeScanner(); setForm(product); setEditing(false) }}
                className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300">
                Abbrechen
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium">
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Edit footer — non-modal, fixed at bottom of page */}
      {editing && !isModal && (
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-4 py-4 flex gap-3 z-20">
          <button onClick={() => { stopBarcodeScanner(); setForm(product); setEditing(false) }}
            className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300">
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-slide-in-up">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-lg mb-1">Artikel löschen?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{product.name} wird dauerhaft gelöscht.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
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
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  )
}
