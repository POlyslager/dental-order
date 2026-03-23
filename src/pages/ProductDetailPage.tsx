import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import Drawer from '../components/Drawer'
import CategorySelect from '../components/CategorySelect'
import {
  ChevronLeft, Pencil, Trash2, ShoppingCart, Check, ExternalLink,
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
  isModal?: boolean
}

export default function ProductDetailPage({ product, onBack, onUpdated, onDeleted, onAddToCart, isModal }: Props) {
  const [form, setForm] = useState(product)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const fallbackQty = Math.max(1, Math.ceil(product.min_stock * 1.5))
  const [orderQty, setOrderQty] = useState(String(fallbackQty))
  const [added, setAdded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])

  const status = stockStatus(form)
  const needsOrder = status === 'red' || status === 'orange'

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
      .limit(1).single()
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

    supabase.from('products').select('category').then(({ data }) => {
      if (data) setCategories([...new Set(data.map(p => p.category))].sort())
    })
  }, [product.id])

  async function handleSave() {
    setSaving(true)
    const parseNum = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? null : n }
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
      onUpdated(data as Product)
      setEditing(false)
    }
  }

  async function handleDelete() {
    await supabase.from('products').delete().eq('id', product.id)
    onDeleted(product.id)
    onBack()
  }

  async function handleAddToCart() {
    await onAddToCart(product.id, parseInt(orderQty) || 1)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
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
            pattern={type === 'number' ? '[0-9.]*' : undefined}
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
      {/* Sub-header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={editing ? () => { setForm(product); setEditing(false) } : onBack}
          className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 p-1 -ml-1 shrink-0">
          <ChevronLeft size={16} />
          Zurück
        </button>
        <h1 className="font-semibold text-slate-800 truncate flex-1">{form.name}</h1>
        {!editing && (
          <>
            <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-sky-600 p-1.5 shrink-0">
              <Pencil size={16} />
            </button>
            <button onClick={() => setConfirmDelete(true)} className="text-slate-300 hover:text-red-400 p-1.5 shrink-0">
              <Trash2 size={16} />
            </button>
          </>
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

          {/* Order action — only when low or critical, not editing */}
          {needsOrder && !editing && (
            <div className={`border-t px-4 py-4 ${styles.border} bg-white`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${status === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                Nachbestellung
              </p>
              <div className="flex items-end gap-3">
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Menge</p>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={orderQty}
                    onChange={e => setOrderQty(e.target.value)}
                    className="w-20 border border-slate-300 rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                {form.last_price != null && (
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">€ {Number(form.last_price).toFixed(2)} / {form.unit}</p>
                    <p className="text-sm font-bold text-slate-800">€ {((parseInt(orderQty) || 0) * Number(form.last_price)).toFixed(2)}</p>
                  </div>
                )}
                <button onClick={handleAddToCart}
                  className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                    added ? 'bg-emerald-100 text-emerald-600' : 'bg-sky-500 hover:bg-sky-600 text-white'
                  }`}>
                  {added ? <Check size={20} /> : <ShoppingCart size={20} />}
                </button>
              </div>
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
              {editField('Beschreibung', 'description', 'textarea')}
              {editField('Notizen', 'notes', 'textarea')}
              <div className="border-t border-slate-100 pt-3 space-y-3">
                {editField('Lieferant', 'preferred_supplier')}
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
                {form.last_price != null ? <Info label="Stückpreis" value={`€ ${Number(form.last_price).toFixed(2)}`} /> : null}
                {form.storage_location ? <Info label="Lagerort" value={form.storage_location} /> : null}
                {form.barcode ? <Info label="Barcode" value={form.barcode} /> : null}
                {lastScan ? <Info label="Zuletzt geprüft" value={new Date(lastScan).toLocaleDateString('de-DE')} /> : null}
              </div>

              {form.description ? <Info label="Beschreibung" value={form.description} /> : null}
              {form.notes ? <Info label="Notizen" value={form.notes} /> : null}

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
            </div>
          )}
        </div>

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

      {/* Delete confirmation */}
      <Drawer open={confirmDelete} onClose={() => setConfirmDelete(false)} zIndex={60}>
        <div className="px-5 py-6 space-y-4">
          <div>
            <h3 className="font-semibold text-slate-800 text-lg">Artikel löschen?</h3>
            <p className="text-sm text-slate-500 mt-1">{product.name} wird dauerhaft gelöscht.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(false)}
              className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600">
              Abbrechen
            </button>
            <button onClick={handleDelete}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-3 text-sm font-medium">
              Löschen
            </button>
          </div>
        </div>
      </Drawer>
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
