import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'

const EMPTY_FORM = {
  article_number: '',
  name: '',
  description: '',
  category: '',
  current_stock: 0,
  min_stock: 1,
  unit: 'pcs',
  preferred_supplier: '',
  supplier_url: '',
  producer_url: '',
  last_price: '',
  storage_location: '',
  expiry_date: '',
  notes: '',
  reorder_quantity: '',
}

const STORAGE_LOCATIONS = [
  'Behandlungsraum 1', 'Behandlungsraum 2', 'Behandlungsraum 3',
  'Behandlungsraum 4', 'Behandlungsraum 5',
  'Steri', 'Rezeption', 'Büro', 'Radiologie', 'Keller',
]

export default function ManageProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*').order('name')
    setProducts(data ?? [])
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('products').insert({
      ...form,
      last_price: form.last_price ? parseFloat(form.last_price) : null,
      reorder_quantity: form.reorder_quantity ? parseFloat(form.reorder_quantity) : null,
      expiry_date: form.expiry_date || null,
      article_number: form.article_number || null,
      supplier_url: form.supplier_url || null,
      producer_url: form.producer_url || null,
      preferred_supplier: form.preferred_supplier || null,
      storage_location: form.storage_location || null,
      description: form.description || null,
      notes: form.notes || null,
    })
    setForm(EMPTY_FORM)
    setShowForm(false)
    setSaving(false)
    fetchProducts()
  }

  async function handleDelete(product: Product) {
    await supabase.from('products').delete().eq('id', product.id)
    setDeleteConfirm(null)
    setProducts(prev => prev.filter(p => p.id !== product.id))
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.article_number?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Artikel verwalten</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-xl"
        >
          + Artikel hinzufügen
        </button>
      </div>

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Artikel suchen…"
          className="w-full border border-slate-300 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                <p className="text-xs text-slate-400">{p.article_number ? `${p.article_number} · ` : ''}{p.category}</p>
              </div>
              <p className="text-sm font-semibold text-slate-700 shrink-0">{p.current_stock} {p.unit}</p>
              <button
                onClick={() => setDeleteConfirm(p)}
                className="text-slate-300 hover:text-red-400 transition-colors shrink-0"
                title="Löschen"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6 2a1 1 0 0 0-1 1v.5H2.5a.5.5 0 0 0 0 1H3v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8h.5a.5.5 0 0 0 0-1H11V3a1 1 0 0 0-1-1H6zm0 1h4v.5H6V3zm-2 2h8v8H4V5zm2 1.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5zm4 0a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-.5-.5z"/>
                </svg>
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-slate-400 py-12">Keine Artikel gefunden</p>
          )}
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold text-slate-800 mb-2">Artikel löschen?</h3>
            <p className="text-sm text-slate-500 mb-5">{deleteConfirm.name} wird dauerhaft gelöscht.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600">
                Abbrechen
              </button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium">
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add product sheet */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Neuer Artikel</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Artikelnummer" value={form.article_number} onChange={v => setForm(f => ({ ...f, article_number: v }))} />
                <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
              </div>
              <Field label="Beschreibung" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
              <Field label="Kategorie *" value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} required />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Bestand" type="number" value={String(form.current_stock)} onChange={v => setForm(f => ({ ...f, current_stock: parseFloat(v) || 0 }))} />
                <Field label="Meldebestand" type="number" value={String(form.min_stock)} onChange={v => setForm(f => ({ ...f, min_stock: parseFloat(v) || 0 }))} />
                <Field label="Einheit" value={form.unit} onChange={v => setForm(f => ({ ...f, unit: v }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Lagerort</label>
                <select
                  value={form.storage_location}
                  onChange={e => setForm(f => ({ ...f, storage_location: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">— Kein Lagerort —</option>
                  {STORAGE_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <Field label="Ablaufdatum" type="date" value={form.expiry_date} onChange={v => setForm(f => ({ ...f, expiry_date: v }))} />
              <Field label="Lieferant" value={form.preferred_supplier} onChange={v => setForm(f => ({ ...f, preferred_supplier: v }))} />
              <Field label="Bestell-Website" type="url" value={form.supplier_url} onChange={v => setForm(f => ({ ...f, supplier_url: v }))} />
              <Field label="Hersteller-Website" type="url" value={form.producer_url} onChange={v => setForm(f => ({ ...f, producer_url: v }))} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stückpreis (€)" type="number" value={form.last_price} onChange={v => setForm(f => ({ ...f, last_price: v }))} />
                <Field label="Nachbestellmenge" type="number" value={form.reorder_quantity} onChange={v => setForm(f => ({ ...f, reorder_quantity: v }))} />
              </div>
              <Field label="Notizen" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />
              <button type="submit" disabled={saving}
                className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm">
                {saving ? 'Speichern…' : 'Artikel hinzufügen'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        step={type === 'number' ? 'any' : undefined}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  )
}
