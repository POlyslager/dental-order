import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Search, X, Trash2, ChevronRight } from 'lucide-react'

interface Category { name: string; count: number }

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Category | null>(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('products').select('category')
    if (data) {
      const counts: Record<string, number> = {}
      for (const p of data) {
        const c = (p.category ?? '').trim()
        if (c) counts[c] = (counts[c] ?? 0) + 1
      }
      setCategories(
        Object.entries(counts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    }
    setLoading(false)
  }

  function openExisting(c: Category) {
    setSelected(c)
    setNewName(c.name)
    setConfirmDelete(false)
  }

  function closePanel() {
    setSelected(null)
    setNewName('')
    setConfirmDelete(false)
  }

  async function handleSave() {
    if (!selected || !newName.trim() || newName.trim() === selected.name) return
    setSaving(true)
    await supabase.from('products').update({ category: newName.trim() }).eq('category', selected.name)
    await load()
    closePanel()
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    await supabase.from('products').update({ category: 'Sonstiges' }).eq('category', selected.name)
    await load()
    closePanel()
  }

  const filtered = categories.filter(c =>
    query === '' || c.name.toLowerCase().includes(query.toLowerCase())
  )

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
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Desktop header */}
          <div className="hidden md:flex border-b border-slate-200 bg-white sticky top-0 z-10">
            <div className="flex-1 px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Kategorie</div>
            <div className="w-24 px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Artikel</div>
            <div className="w-8" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.map(c => (
              <div key={c.name} onClick={() => openExisting(c)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors flex items-center">
                <div className="flex-1 px-4 py-3.5 text-sm font-semibold text-slate-800 truncate">{c.name}</div>
                <div className="w-24 px-4 py-3.5 text-sm text-slate-400">{c.count}</div>
                <div className="px-4 py-3.5 text-slate-300"><ChevronRight size={14} /></div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-16">Keine Kategorien gefunden</p>
          )}
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/20" onClick={closePanel} />
          <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">Kategorie bearbeiten</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm" />
                <p className="text-xs text-slate-400 mt-1.5">{selected.count} Artikel in dieser Kategorie</p>
              </div>

              <div className="pt-4 border-t border-slate-100">
                {confirmDelete ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">
                      Alle {selected.count} Artikel werden zu „Sonstiges" verschoben.
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
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closePanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Abbrechen</button>
              <button onClick={handleSave} disabled={saving || !newName.trim() || newName.trim() === selected.name}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                {saving ? 'Speichern…' : 'Umbenennen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
