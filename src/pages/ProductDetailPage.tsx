import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import Drawer from '../components/Drawer'
import CategorySelect from '../components/CategorySelect'
import {
  ArrowLeft, Pencil, Trash2, ShoppingCart, Check, AlertCircle, ExternalLink,
} from 'lucide-react'

const STORAGE_LOCATIONS = [
  'Behandlungsraum 1', 'Behandlungsraum 2', 'Behandlungsraum 3',
  'Behandlungsraum 4', 'Behandlungsraum 5',
  'Steri', 'Rezeption', 'Büro', 'Radiologie', 'Keller',
]
const UNITS = [
  'Stück', 'Packung', 'Box', 'Kartusche', 'Flasche', 'Tube',
  'Beutel', 'Spritze', 'Set', 'Kit', 'Kanister', 'Dose', 'Ries', 'Paar', 'Rolle',
]

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
}

export default function ProductDetailPage({ product, onBack, onUpdated, onDeleted, onAddToCart }: Props) {
  const [form, setForm] = useState(product)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [orderQty, setOrderQty] = useState(Math.max(1, Math.ceil(product.min_stock * 1.5)))
  const [added, setAdded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)

  const status = stockStatus(form)
  const needsOrder = status === 'red' || status === 'orange'
  const reorderQty = Math.max(1, Math.ceil(form.min_stock * 1.5))
  const altTotalPrice = form.alternative_price ? (form.alternative_price * reorderQty).toFixed(2) : null

  const barMax = Math.max(form.current_stock, form.min_stock * 2.5, 1)
  const fillPct = Math.min(100, (form.current_stock / barMax) * 100)
  const thresholdPct = Math.min(99, (form.min_stock / barMax) * 100)

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
  }, [product.id])

  async function handleSave() {
    setSaving(true)
    const { data, error } = await supabase.from('products').update({
      article_number: form.article_number,
      name: form.name,
      description: form.description,
      category: form.category,
      current_stock: form.current_stock,
      min_stock: form.min_stock,
      unit: form.unit,
      storage_location: form.storage_location,
      expiry_date: form.expiry_date || null,
      notes: form.notes,
      last_price: form.last_price,
      preferred_supplier: form.preferred_supplier,
      supplier_url: form.supplier_url,
      producer_url: form.producer_url,
      alternative_price: form.alternative_price,
      alternative_url: form.alternative_url,
      alternative_supplier: form.alternative_supplier,
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
    await onAddToCart(product.id, orderQty)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  function field(label: string, key: keyof Product, type: 'text' | 'number' | 'date' | 'url' | 'select' | 'unit' = 'text') {
    const val = form[key] as string | number | null
    if (!editing) {
      if (!val && val !== 0) return null
      return (
        <div>
          <p className="text-xs text-slate-400 mb-0.5">{label}</p>
          {type === 'url' ? (
            <a href={val as string} target="_blank" rel="noopener noreferrer"
              className="text-sm text-sky-600 hover:underline break-all flex items-center gap-1">
              <ExternalLink size={12} />{val as string}
            </a>
          ) : (
            <p className="text-sm text-slate-800">
              {type === 'date' && val ? new Date(val as string).toLocaleDateString('de-DE') : String(val)}
            </p>
          )}
        </div>
      )
    }
    return (
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
        {type === 'select' ? (
          <select value={(val as string) ?? ''}
            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">— Kein Lagerort —</option>
            {STORAGE_LOCATIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : type === 'unit' ? (
          <CategorySelect value={(val as string) ?? ''} onChange={v => setForm(p => ({ ...p, [key]: v }))} categories={UNITS} />
        ) : (
          <input type={type} step={type === 'number' ? 'any' : undefined}
            value={(val as string | number) ?? ''}
            onChange={e => setForm(p => ({
              ...p,
              [key]: type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value,
            }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      {/* Sub-header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={editing ? () => { setForm(product); setEditing(false) } : onBack}
          className="text-slate-500 hover:text-slate-800 p-1 -ml-1 shrink-0">
          <ArrowLeft size={20} />
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

      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-24">

        {/* ── Stock card (always shown) — order section appended when low/critical ── */}
        <div className={`rounded-2xl border overflow-hidden ${styles.border}`}>
          {/* Stock status */}
          <div className={`p-4 ${styles.bg}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-white/70 ${styles.text}`}>
                {styles.label}
              </span>
              {form.article_number && <span className="text-xs text-slate-400">{form.article_number}</span>}
            </div>
            <div className="flex items-end justify-between mb-3">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Aktueller Bestand</p>
                <p className={`text-4xl font-bold ${styles.text}`}>
                  {form.current_stock} <span className="text-base font-normal text-slate-400">{form.unit}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-0.5">Meldebestand</p>
                <p className="text-xl font-semibold text-slate-700">{form.min_stock}</p>
              </div>
            </div>
            <div className="relative h-2 bg-white/60 rounded-full overflow-hidden">
              <div className={`absolute left-0 top-0 h-full rounded-full ${styles.bar}`} style={{ width: `${fillPct}%` }} />
              <div className="absolute top-0 h-full w-[3px] bg-slate-500 opacity-40" style={{ left: `${thresholdPct}%` }} />
            </div>
            {editing && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {field('Aktuell', 'current_stock', 'number')}
                {field('Meldebestand', 'min_stock', 'number')}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
                  <CategorySelect value={form.unit ?? ''} onChange={v => setForm(p => ({ ...p, unit: v }))} categories={UNITS} />
                </div>
              </div>
            )}
          </div>

          {/* Order action — only when low or critical */}
          {needsOrder && !editing && (
            <div className={`border-t px-4 py-4 ${styles.border} bg-white`}>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={14} className={status === 'red' ? 'text-red-500' : 'text-amber-500'} />
                <p className={`text-xs font-semibold uppercase tracking-wide ${status === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                  Nachbestellung
                </p>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-2">
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">Menge</p>
                    <input type="number" min={1} value={orderQty}
                      onChange={e => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  {form.last_price != null && (
                    <p className="text-xs text-slate-500">€ {form.last_price} pro {form.unit}</p>
                  )}
                  {form.last_price != null && (
                    <p className="text-sm font-bold text-slate-800">
                      Gesamt € {(orderQty * form.last_price).toFixed(2)}
                    </p>
                  )}
                </div>
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
              {field('Name', 'name')}
              {field('Beschreibung', 'description')}
            </div>
          ) : (
            form.description && <p className="text-sm text-slate-500">{form.description}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            {field('Kategorie', 'category')}
            {field('Lagerort', 'storage_location', editing ? 'select' : 'text')}
            {field('Ablaufdatum', 'expiry_date', 'date')}
            {lastScan && !editing && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Zuletzt geprüft</p>
                <p className="text-sm text-slate-800">{new Date(lastScan).toLocaleDateString('de-DE')}</p>
              </div>
            )}
          </div>

          {field('Notizen', 'notes')}

          {/* Lieferant + websites — view mode */}
          {!editing && (form.preferred_supplier || form.supplier_url || form.producer_url) && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              {form.preferred_supplier && (
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Lieferant</p>
                  <p className="text-sm text-slate-800">{form.preferred_supplier}</p>
                </div>
              )}
              {form.supplier_url && (
                <a href={form.supplier_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-sky-600 hover:underline">
                  <ExternalLink size={13} /> Bestellwebsite öffnen
                </a>
              )}
              {form.producer_url && (
                <a href={form.producer_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-sky-600 hover:underline">
                  <ExternalLink size={13} /> Hersteller-Website öffnen
                </a>
              )}
            </div>
          )}

          {/* Edit mode: all editable fields */}
          {editing && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              {field('Stückpreis (€)', 'last_price', 'number')}
              {field('Lieferant', 'preferred_supplier')}
              {field('Bestellwebsite', 'supplier_url', 'url')}
              {field('Hersteller-Website', 'producer_url', 'url')}
            </div>
          )}
        </div>

        {/* ── Alternative ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Günstigere Alternative</p>
          <div className="grid grid-cols-2 gap-4">
            {field('Alternativer Preis (€)', 'alternative_price', 'number')}
            {field('Alternativer Lieferant', 'alternative_supplier')}
          </div>
          {field('Alternative Website', 'alternative_url', 'url')}
          {form.alternative_price && form.last_price && !editing && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-emerald-700">Ersparnis pro Einheit</span>
              <span className="font-bold text-emerald-700">
                € {(form.last_price - form.alternative_price).toFixed(2)}
                {reorderQty ? ` (€ ${((form.last_price - form.alternative_price) * reorderQty).toFixed(2)} gesamt)` : ''}
              </span>
            </div>
          )}
          {altTotalPrice && !editing && (
            <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-600">Gesamtkosten (Alternative)</span>
              <span className="font-bold text-slate-800">€ {altTotalPrice}</span>
            </div>
          )}
        </div>

      </div>

      {/* Edit footer */}
      {editing && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-4 py-4 flex gap-3 z-20">
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
