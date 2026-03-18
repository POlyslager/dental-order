import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import Drawer from './Drawer'
import { Pencil, Trash2, X } from 'lucide-react'

interface Props {
  product: Product
  onClose: () => void
  onUpdated: (p: Product) => void
  onDeleted: (id: string) => void
}

const STORAGE_LOCATIONS = [
  'Behandlungsraum 1', 'Behandlungsraum 2', 'Behandlungsraum 3',
  'Behandlungsraum 4', 'Behandlungsraum 5',
  'Steri', 'Rezeption', 'Büro', 'Radiologie', 'Keller',
]

function stockStatus(p: Product): 'green' | 'orange' | 'red' {
  if (p.current_stock <= p.min_stock) return 'red'
  if (p.current_stock <= p.min_stock * 1.5) return 'orange'
  return 'green'
}

const STATUS_STYLES = {
  green:  { bar: 'bg-emerald-400', text: 'text-emerald-600', bg: 'bg-emerald-50',  border: 'border-emerald-200', label: 'Ausreichend' },
  orange: { bar: 'bg-amber-400',   text: 'text-amber-600',   bg: 'bg-amber-50',    border: 'border-amber-200',   label: 'Niedrig'     },
  red:    { bar: 'bg-red-400',     text: 'text-red-600',     bg: 'bg-red-50',      border: 'border-red-200',     label: 'Nachbestellen' },
}

export default function ProductDetailModal({ product, onClose, onUpdated, onDeleted }: Props) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(product)
  const [saving, setSaving] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const status = stockStatus(form)
  const styles = STATUS_STYLES[status]

  const stockPercent = form.min_stock > 0
    ? Math.min(100, Math.round((form.current_stock / (form.min_stock * 2)) * 100))
    : 100

  const reorderQty = Math.max(1, Math.ceil(form.min_stock * 1.5))

  const totalPrice = form.last_price
    ? (form.last_price * reorderQty).toFixed(2)
    : null

  const altTotalPrice = form.alternative_price
    ? (form.alternative_price * reorderQty).toFixed(2)
    : null

  useEffect(() => {
    supabase
      .from('stock_movements')
      .select('created_at')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => { if (data) setLastScan(data.created_at) })
  }, [product.id])

  async function handleSave() {
    setSaving(true)
    const { data, error } = await supabase
      .from('products')
      .update({
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
      })
      .eq('id', product.id)
      .select()
      .single()
    setSaving(false)
    if (!error && data) {
      onUpdated(data)
      setEditing(false)
    }
  }

  async function handleDelete() {
    await supabase.from('products').delete().eq('id', product.id)
    onDeleted(product.id)
    onClose()
  }

  function f(label: string, field: keyof Product, type: 'text' | 'number' | 'date' | 'url' | 'select' = 'text', options?: string[]) {
    const value = form[field] as string | number | null
    if (!editing) {
      if (!value && value !== 0) return null
      return (
        <div>
          <p className="text-xs text-slate-400 mb-0.5">{label}</p>
          {type === 'url' ? (
            <a href={value as string} target="_blank" rel="noopener noreferrer"
              className="text-sm text-sky-600 hover:underline break-all">{value as string}</a>
          ) : (
            <p className="text-sm text-slate-800">{type === 'date' && value ? new Date(value as string).toLocaleDateString('de-DE') : String(value)}</p>
          )}
        </div>
      )
    }
    return (
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
        {type === 'select' && options ? (
          <select
            value={(value as string) ?? ''}
            onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">— Kein Lagerort —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type={type}
            step={type === 'number' ? 'any' : undefined}
            value={(value as string | number) ?? ''}
            onChange={e => setForm(prev => ({
              ...prev,
              [field]: type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value
            }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        )}
      </div>
    )
  }

  return (
    <>
      <Drawer open onClose={editing ? () => { setForm(product); setEditing(false) } : onClose}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${styles.bg} ${styles.text}`}>
              {styles.label}
            </span>
            {form.article_number && (
              <span className="text-xs text-slate-400">{form.article_number}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!editing && (
              <>
                <button onClick={() => setEditing(true)}
                  className="text-slate-500 hover:text-sky-600 transition-colors p-1.5">
                  <Pencil size={16} />
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="text-slate-300 hover:text-red-400 transition-colors p-1.5">
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button onClick={editing ? () => { setForm(product); setEditing(false) } : onClose}
              className="text-slate-400 hover:text-slate-600 p-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain flex-1 px-5 py-4 space-y-5">
          <div className="space-y-3">
            {editing ? (
              <>
                {f('Name', 'name')}
                {f('Beschreibung', 'description')}
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-800">{form.name}</h2>
                {form.description && <p className="text-sm text-slate-500">{form.description}</p>}
              </>
            )}
          </div>

          {/* Stock status */}
          <div className={`rounded-2xl p-4 border ${styles.border} ${styles.bg}`}>
            <div className="flex items-end justify-between mb-2">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Aktueller Bestand</p>
                <p className={`text-4xl font-bold ${styles.text}`}>{form.current_stock} <span className="text-base font-normal text-slate-400">{form.unit}</span></p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-0.5">Meldebestand</p>
                <p className="text-xl font-semibold text-slate-700">{form.min_stock}</p>
              </div>
            </div>
            <div className="h-2 bg-white/60 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${stockPercent}%` }} />
            </div>
            {editing && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {f('Aktuell', 'current_stock', 'number')}
                {f('Meldebestand', 'min_stock', 'number')}
                {f('Einheit', 'unit')}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {f('Kategorie', 'category')}
            {f('Lagerort', 'storage_location', editing ? 'select' : 'text', STORAGE_LOCATIONS)}
            {f('Ablaufdatum', 'expiry_date', 'date')}
            {lastScan && !editing && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Zuletzt geprüft</p>
                <p className="text-sm text-slate-800">{new Date(lastScan).toLocaleDateString('de-DE')}</p>
              </div>
            )}
          </div>

          {f('Notizen', 'notes')}

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Bestellung</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {f('Stückpreis (€)', 'last_price', 'number')}
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Nachbestellmenge</p>
                  <p className="text-sm text-slate-800">{reorderQty} <span className="text-slate-400">(Meldebestand × 1,5)</span></p>
                </div>
              </div>
              {totalPrice && !editing && (
                <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-slate-600">Gesamtkosten</span>
                  <span className="font-bold text-slate-800">€ {totalPrice}</span>
                </div>
              )}
              {f('Lieferant', 'preferred_supplier')}
              {f('Bestellwebsite', 'supplier_url', 'url')}
              {f('Hersteller-Website', 'producer_url', 'url')}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Günstigere Alternative</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {f('Alternativer Preis (€)', 'alternative_price', 'number')}
                {f('Alternativer Lieferant', 'alternative_supplier')}
              </div>
              {f('Alternative Website', 'alternative_url', 'url')}
              {form.alternative_price && form.last_price && !editing && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-emerald-700">Ersparnis pro Einheit</span>
                  <span className="font-bold text-emerald-700">
                    € {(form.last_price - form.alternative_price).toFixed(2)}
                    {form.reorder_quantity ? ` (€ ${((form.last_price - form.alternative_price) * form.reorder_quantity).toFixed(2)} gesamt)` : ''}
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
        </div>

        {/* Footer */}
        {editing && (
          <div className="shrink-0 border-t border-slate-100 px-5 py-4 flex gap-3">
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
      </Drawer>

      {/* Delete confirmation drawer */}
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
    </>
  )
}
