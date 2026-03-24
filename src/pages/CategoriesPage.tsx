import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Category } from '../lib/types'
import { Plus, Search, X, Trash2, ChevronRight } from 'lucide-react'

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm'

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [productCounts, setProductCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Category | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<{ name: string; description: string }>({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: cats }, { data: products }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('products').select('category'),
    ])
    setCategories((cats ?? []) as Category[])
    const counts: Record<string, number> = {}
    for (const p of products ?? []) {
      const c = (p.category ?? '').trim()
      if (c) counts[c] = (counts[c] ?? 0) + 1
    }
    setProductCounts(counts)
    setLoading(false)
  }

  function openNew() {
    setForm({ name: '', description: '' })
    setSelected(null)
    setIsNew(true)
    setConfirmDelete(false)
  }

  function openExisting(c: Category) {
    setForm({ name: c.name, description: c.description ?? '' })
    setSelected(c)
    setIsNew(false)
    setConfirmDelete(false)
  }

  function closePanel() {
    setSelected(null)
    setIsNew(false)
    setForm({ name: '', description: '' })
    setConfirmDelete(false)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = { name: form.name.trim(), description: form.description.trim() || null }
    if (isNew) {
      const { data } = await supabase.from('categories').insert(payload).select().single()
      if (data) {
        setCategories(c => [...c, data as Category].sort((a, b) => a.name.localeCompare(b.name)))
        closePanel()
      }
    } else if (selected) {
      const oldName = selected.name
      const { data } = await supabase.from('categories').update(payload).eq('id', selected.id).select().single()
      if (data) {
        if (oldName !== form.name.trim()) {
          await supabase.from('products').update({ category: form.name.trim() }).eq('category', oldName)
        }
        setCategories(c => c.map(x => x.id === selected.id ? data as Category : x).sort((a, b) => a.name.localeCompare(b.name)))
        closePanel()
        await load()
      }
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    await supabase.from('products').update({ category: 'Sonstiges' }).eq('category', selected.name)
    await supabase.from('categories').delete().eq('id', selected.id)
    await load()
    closePanel()
  }

  const filtered = categories.filter(c =>
    query === '' || c.name.toLowerCase().includes(query.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(query.toLowerCase())
  )

  const panelOpen = isNew || selected != null

  return (
    <div className="w-full relative">
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
          <span className="hidden sm:inline">Neue Kategorie</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Desktop header */}
          <div className="hidden md:grid border-b border-slate-200 bg-white sticky top-0 z-10" style={{ gridTemplateColumns: '1.5fr 2fr 0.5fr 2rem' }}>
            {['Kategorie', 'Beschreibung', 'Artikel'].map(h => (
              <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</div>
            ))}
            <div />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.map(c => (
              <div key={c.id} onClick={() => openExisting(c)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                {/* Desktop */}
                <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '1.5fr 2fr 0.5fr 2rem' }}>
                  <div className="px-4 py-3.5 text-sm font-semibold text-slate-800 truncate">{c.name}</div>
                  <div className="px-4 py-3.5 text-sm text-slate-400 truncate">{c.description ?? '—'}</div>
                  <div className="px-4 py-3.5 text-sm text-slate-400">{productCounts[c.name] ?? 0}</div>
                  <div className="py-3.5 text-slate-300"><ChevronRight size={14} /></div>
                </div>
                {/* Mobile */}
                <div className="flex md:hidden items-center px-4 py-3.5 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    {c.description && <p className="text-xs text-slate-400 truncate mt-0.5">{c.description}</p>}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{productCounts[c.name] ?? 0} Artikel</span>
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-16">Keine Kategorien gefunden</p>
          )}
        </>
      )}

      {/* Detail panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/20" onClick={closePanel} />
          <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">{isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten'}</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="z.B. Desinfektion" autoFocus className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Beschreibung</label>
                <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optionale Beschreibung…"
                  className={`${inputCls} resize-none`} />
              </div>

              {!isNew && (
                <div className="pt-4 border-t border-slate-100">
                  {confirmDelete ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">
                        {(productCounts[selected!.name] ?? 0) > 0
                          ? `Alle ${productCounts[selected!.name]} Artikel werden zu „Sonstiges" verschoben.`
                          : 'Kategorie wirklich löschen?'}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDelete(false)}
                          className="flex-1 border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Abbrechen</button>
                        <button onClick={handleDelete}
                          className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">Löschen</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors">
                      <Trash2 size={14} /> Kategorie löschen
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closePanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Abbrechen</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
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
