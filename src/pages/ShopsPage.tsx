import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PriceComparisonShop } from '../lib/types'
import { Plus, Search, X, Trash2, ChevronRight } from 'lucide-react'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export default function ShopsPage() {
  const [shops, setShops] = useState<PriceComparisonShop[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PriceComparisonShop | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<Partial<PriceComparisonShop>>({})
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [undoShop, setUndoShop] = useState<PriceComparisonShop | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('price_comparison_shops').select('*').order('base_url')
    setShops((data ?? []) as PriceComparisonShop[])
    setLoading(false)
  }

  function openNew() {
    setForm({ base_url: '', search_paths: ['/search?q={q}'], is_active: true, notes: null, min_order_value: null })
    setSelected(null)
    setIsNew(true)
    setConfirmDelete(false)
  }

  function openExisting(shop: PriceComparisonShop) {
    setForm({ ...shop })
    setSelected(shop)
    setIsNew(false)
    setConfirmDelete(false)
  }

  function closePanel() {
    setClosing(true)
    setTimeout(() => {
      setSelected(null)
      setIsNew(false)
      setForm({})
      setConfirmDelete(false)
      setClosing(false)
    }, 260)
  }

  async function handleSave() {
    if (!form.base_url?.trim()) return
    setSaving(true)
    const payload = {
      base_url: form.base_url.trim(),
      search_paths: form.search_paths ?? [],
      is_active: form.is_active ?? true,
      notes: form.notes ?? null,
      min_order_value: form.min_order_value ?? null,
    }
    if (isNew) {
      const { data } = await supabase.from('price_comparison_shops').insert(payload).select().single()
      if (data) {
        setShops(s => [...s, data as PriceComparisonShop].sort((a, b) => a.base_url.localeCompare(b.base_url)))
        setToast('Shop hinzugefügt')
        closePanel()
      }
    } else if (selected) {
      const { data } = await supabase.from('price_comparison_shops').update(payload).eq('id', selected.id).select().single()
      if (data) {
        setShops(s => s.map(x => x.id === selected.id ? data as PriceComparisonShop : x))
        setToast('Shop gespeichert')
        closePanel()
      }
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    const snapshot = { ...selected }
    await supabase.from('price_comparison_shops').delete().eq('id', selected.id)
    setShops(s => s.filter(x => x.id !== selected.id))
    setUndoShop(snapshot)
    setToast('Shop gelöscht')
    closePanel()
  }

  async function handleUndoDelete() {
    if (!undoShop) return
    const { id, created_at, ...payload } = undoShop
    const { data } = await supabase.from('price_comparison_shops').insert(payload).select().single()
    if (data) setShops(s => [...s, data as PriceComparisonShop].sort((a, b) => a.base_url.localeCompare(b.base_url)))
    setUndoShop(null)
  }

  const filtered = shops.filter(s =>
    query === '' || s.base_url.toLowerCase().includes(query.toLowerCase())
  )

  const panelOpen = isNew || selected != null

  return (
    <div className="w-full relative">
      {toast && <Toast message={toast} onClose={() => { setToast(null); if (!undoShop) setUndoShop(null) }} onUndo={undoShop ? handleUndoDelete : undefined} />}
      {confirmDelete && (
        <ConfirmDialog
          message="Shop wirklich löschen?"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {/* Toolbar */}
      <div className="px-4 pt-3 pb-3 flex gap-2 items-center">
        <div className="relative w-52 shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Suchen…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full border border-slate-200 rounded-xl pl-8 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={openNew}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium shrink-0"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Neuer Shop</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Desktop header */}
          <div className="hidden md:grid border-b border-slate-200 bg-white sticky top-0 z-10" style={{ gridTemplateColumns: '2fr 0.7fr 2rem' }}>
            {['URL', 'Status'].map(h => (
              <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</div>
            ))}
            <div />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.map(shop => (
              <div key={shop.id} onClick={() => openExisting(shop)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                {/* Desktop */}
                <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '2fr 0.7fr 2rem' }}>
                  <div className="px-4 py-3.5 text-sm font-semibold text-slate-800 truncate">{displayUrl(shop.base_url)}</div>
                  <div className="px-4 py-3.5">
                    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${shop.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {shop.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </div>
                  <div className="py-3.5 text-slate-300"><ChevronRight size={14} /></div>
                </div>
                {/* Mobile */}
                <div className="flex md:hidden items-center px-4 py-3.5 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{displayUrl(shop.base_url)}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{shop.search_paths.length} Pfad(e)</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${shop.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {shop.is_active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-16">Keine Shops gefunden</p>
          )}
        </>
      )}

      {/* Detail panel */}
      {(panelOpen || closing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white z-50 flex flex-col overflow-y-auto md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl md:overflow-hidden ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">{isNew ? 'Neuer Shop' : (form.base_url ? displayUrl(form.base_url) : 'Shop bearbeiten')}</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <Field label="Basis-URL">
                <input type="url" placeholder="https://www.henryschein-dental.de"
                  value={form.base_url ?? ''} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  className={inputCls} />
              </Field>
              <Field label="Such-URLs (eine pro Zeile, {q} = Suchbegriff)">
                <textarea rows={4}
                  value={(form.search_paths ?? []).join('\n')}
                  onChange={e => setForm(f => ({ ...f, search_paths: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                  className={`${inputCls} resize-none font-mono`}
                  placeholder="https://example.com/search?q={q}" />
              </Field>
              <Field label="Status">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${form.is_active ? 'bg-sky-500' : 'bg-slate-200'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${form.is_active ? 'left-6' : 'left-1'}`} />
                  </div>
                  <span className="text-sm text-slate-700">{form.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                </label>
              </Field>

              <Field label="Mindestbestellwert (€)">
                <input type="number" min="0" step="0.01"
                  value={form.min_order_value ?? ''}
                  onChange={e => setForm(f => ({ ...f, min_order_value: e.target.value ? parseFloat(e.target.value) : null }))}
                  placeholder="z.B. 50.00" className={inputCls} />
              </Field>
              <Field label="Notizen">
                <textarea rows={3}
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))}
                  placeholder="Interne Notizen zum Shop…" className={`${inputCls} resize-none`} />
              </Field>

              {!isNew && (
                <div className="pt-4 border-t border-slate-100">
                  <button onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors">
                    <Trash2 size={14} /> Shop löschen
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closePanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Abbrechen</button>
              <button onClick={handleSave} disabled={saving || !form.base_url?.trim()}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
