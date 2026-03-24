import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Search, X, Trash2, RefreshCw, ChevronRight } from 'lucide-react'

interface Supplier { id: string; name: string }

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { loadWithSync() }, [])

  async function load() {
    const { data } = await supabase.from('suppliers').select('id, name').order('name')
    setSuppliers((data ?? []) as Supplier[])
    setLoading(false)
  }

  async function loadWithSync() {
    const { data } = await supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null)
    if (data) {
      const names = [...new Set(data.map(p => p.preferred_supplier as string))].filter(Boolean)
      if (names.length > 0) {
        await supabase.from('suppliers').upsert(names.map(n => ({ name: n })), { onConflict: 'name' })
      }
    }
    await load()
  }

  async function syncFromProducts() {
    setSyncing(true)
    await loadWithSync()
    setSyncing(false)
  }

  function openNew() {
    setName('')
    setSelected(null)
    setIsNew(true)
    setConfirmDelete(false)
  }

  function openExisting(s: Supplier) {
    setName(s.name)
    setSelected(s)
    setIsNew(false)
    setConfirmDelete(false)
  }

  function closePanel() {
    setSelected(null)
    setIsNew(false)
    setName('')
    setConfirmDelete(false)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    if (isNew) {
      const { data } = await supabase.from('suppliers').insert({ name: name.trim() }).select('id, name').single()
      if (data) {
        setSuppliers(s => [...s, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)))
        closePanel()
      }
    } else if (selected) {
      const [{ data }] = await Promise.all([
        supabase.from('suppliers').update({ name: name.trim() }).eq('id', selected.id).select('id, name').single(),
        supabase.from('products').update({ preferred_supplier: name.trim() }).eq('preferred_supplier', selected.name),
      ])
      if (data) {
        setSuppliers(s => s.map(x => x.id === selected.id ? data as Supplier : x).sort((a, b) => a.name.localeCompare(b.name)))
        closePanel()
      }
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    await supabase.from('suppliers').delete().eq('id', selected.id)
    setSuppliers(s => s.filter(x => x.id !== selected.id))
    closePanel()
  }

  const filtered = suppliers.filter(s =>
    query === '' || s.name.toLowerCase().includes(query.toLowerCase())
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
          onClick={syncFromProducts}
          disabled={syncing}
          title="Aus Produkten synchronisieren"
          className="p-2 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 bg-white"
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={openNew}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium shrink-0"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Neuer Lieferant</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Desktop header */}
          <div className="hidden md:flex border-b border-slate-200 bg-white sticky top-0 z-10">
            <div className="flex-1 px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</div>
            <div className="w-8" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.map(s => (
              <div key={s.id} onClick={() => openExisting(s)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors flex items-center">
                <div className="flex-1 px-4 py-3.5 text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                <div className="px-4 py-3.5 text-slate-300"><ChevronRight size={14} /></div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-16">Keine Lieferanten gefunden</p>
          )}
        </>
      )}

      {panelOpen && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/20" onClick={closePanel} />
          <div className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">{isNew ? 'Neuer Lieferant' : 'Lieferant bearbeiten'}</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="z.B. Henry Schein" autoFocus
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm" />
              </div>

              {!isNew && (
                <div className="pt-4 border-t border-slate-100">
                  {confirmDelete ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">Lieferant wirklich löschen?</p>
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
                      <Trash2 size={14} /> Lieferant löschen
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closePanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Abbrechen</button>
              <button onClick={handleSave} disabled={saving || !name.trim()}
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
