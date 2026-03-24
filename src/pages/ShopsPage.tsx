import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PriceComparisonShop } from '../lib/types'
import { Plus, Search, ChevronRight, X, Trash2 } from 'lucide-react'

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function ShopsPage() {
  const [shops, setShops] = useState<PriceComparisonShop[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PriceComparisonShop | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<Partial<PriceComparisonShop>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('price_comparison_shops').select('*').order('domain')
    setShops((data ?? []) as PriceComparisonShop[])
    setLoading(false)
  }

  function openNew() {
    setForm({ domain: '', base_url: '', search_paths: ['/search?q={q}'], type: 'html', is_active: true })
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
    setSelected(null)
    setIsNew(false)
    setForm({})
    setConfirmDelete(false)
  }

  async function handleSave() {
    if (!form.domain?.trim() || !form.base_url?.trim()) return
    setSaving(true)
    const payload = {
      domain: form.domain.trim(),
      base_url: form.base_url.trim(),
      search_paths: form.search_paths ?? [],
      type: form.type ?? 'html',
      is_active: form.is_active ?? true,
    }
    if (isNew) {
      const { data } = await supabase.from('price_comparison_shops').insert(payload).select().single()
      if (data) {
        setShops(s => [...s, data as PriceComparisonShop].sort((a, b) => a.domain.localeCompare(b.domain)))
        closePanel()
      }
    } else if (selected) {
      const { data } = await supabase.from('price_comparison_shops').update(payload).eq('id', selected.id).select().single()
      if (data) {
        setShops(s => s.map(x => x.id === selected.id ? data as PriceComparisonShop : x))
        closePanel()
      }
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    await supabase.from('price_comparison_shops').delete().eq('id', selected.id)
    setShops(s => s.filter(x => x.id !== selected.id))
    closePanel()
  }

  const filtered = shops.filter(s =>
    query === '' || s.domain.toLowerCase().includes(query.toLowerCase())
  )

  const panelOpen = isNew || selected != null

  return (
    <div className="max-w-5xl mx-auto p-4 pb-8">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Shop suchen…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-medium transition-colors shrink-0"
        >
          <Plus size={15} />
          Hinzufügen
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Domain</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Typ</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Suchpfade</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(shop => (
                  <tr key={shop.id} onClick={() => openExisting(shop)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3.5 font-medium text-slate-800">{shop.domain}</td>
                    <td className="px-4 py-3.5 text-slate-500">{shop.type}</td>
                    <td className="px-4 py-3.5 text-slate-400 text-xs">{shop.search_paths.length}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${
                        shop.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {shop.is_active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300"><ChevronRight size={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-10">Keine Shops gefunden</p>
            )}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map(shop => (
              <div key={shop.id} onClick={() => openExisting(shop)}
                className="bg-white rounded-2xl border border-slate-100 px-4 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{shop.domain}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{shop.type} · {shop.search_paths.length} Pfad(e)</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  shop.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                }`}>
                  {shop.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
                <ChevronRight size={14} className="text-slate-300 shrink-0" />
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-10 bg-white rounded-2xl border border-slate-100">Keine Shops gefunden</p>
            )}
          </div>
        </>
      )}

      {/* Detail panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/20" onClick={closePanel} />
          <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">{isNew ? 'Neuer Shop' : (form.domain || 'Shop bearbeiten')}</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <Field label="Domain">
                <input type="text" placeholder="z.B. henryschein-dental.de"
                  value={form.domain ?? ''}
                  onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Basis-URL">
                <input type="url" placeholder="https://www.henryschein-dental.de"
                  value={form.base_url ?? ''}
                  onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Typ">
                <select value={form.type ?? 'html'}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as 'html' | 'dm' }))}
                  className={inputCls}
                >
                  <option value="html">HTML-Scraping</option>
                  <option value="dm">DM API</option>
                </select>
              </Field>
              <Field label="Suchpfade (eine pro Zeile, {q} = Suchbegriff)">
                <textarea rows={4}
                  value={(form.search_paths ?? []).join('\n')}
                  onChange={e => setForm(f => ({ ...f, search_paths: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                  className={`${inputCls} resize-none font-mono`}
                  placeholder="/search?q={q}"
                />
              </Field>
              <Field label="Status">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${form.is_active ? 'bg-sky-500' : 'bg-slate-200'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${form.is_active ? 'left-6' : 'left-1'}`} />
                  </div>
                  <span className="text-sm text-slate-700">{form.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                </label>
              </Field>

              {!isNew && (
                <div className="pt-4 border-t border-slate-100">
                  {confirmDelete ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">Shop wirklich löschen?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDelete(false)}
                          className="flex-1 border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                          Abbrechen
                        </button>
                        <button onClick={handleDelete}
                          className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
                          Löschen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors">
                      <Trash2 size={14} />
                      Shop löschen
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closePanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={handleSave} disabled={saving || !form.domain?.trim() || !form.base_url?.trim()}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
