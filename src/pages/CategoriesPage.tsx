import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Search, X, Trash2, ChevronRight, Pencil } from 'lucide-react'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

interface CategoryRow {
  name: string
  description: string | null
  productCount: number
  supplierCount: number
}

const inputCls = 'w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400'

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CategoryRow | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ name: string; description: string }>({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: productRows }, { data: descRows }] = await Promise.all([
      supabase.from('products').select('category, preferred_supplier'),
      supabase.from('categories').select('name, description'),
    ])

    // Description lookup from categories table
    const descMap: Record<string, string | null> = {}
    for (const r of (descRows ?? []) as { name: string; description: string | null }[]) {
      descMap[r.name] = r.description
    }

    // Aggregate from products
    const counts: Record<string, number> = {}
    const suppliers: Record<string, Set<string>> = {}
    for (const p of (productRows ?? []) as { category: string; preferred_supplier: string | null }[]) {
      const c = (p.category ?? '').trim()
      if (!c) continue
      counts[c] = (counts[c] ?? 0) + 1
      if (p.preferred_supplier) {
        if (!suppliers[c]) suppliers[c] = new Set()
        suppliers[c].add(p.preferred_supplier)
      }
    }

    const names = Object.keys(counts).sort((a, b) => a.localeCompare(b))
    setCategories(names.map(name => ({
      name,
      description: descMap[name] ?? null,
      productCount: counts[name],
      supplierCount: suppliers[name]?.size ?? 0,
    })))
    setLoading(false)
  }

  function openNew() {
    setForm({ name: '', description: '' })
    setSelected(null)
    setIsNew(true)
    setEditing(true)
    setConfirmDelete(false)
  }

  function openExisting(c: CategoryRow) {
    setForm({ name: c.name, description: c.description ?? '' })
    setSelected(c)
    setIsNew(false)
    setEditing(false)
    setConfirmDelete(false)
  }

  function closePanel() {
    setClosing(true)
    setTimeout(() => {
      setSelected(null)
      setIsNew(false)
      setEditing(false)
      setForm({ name: '', description: '' })
      setConfirmDelete(false)
      setClosing(false)
    }, 260)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const name = form.name.trim()
    const description = form.description.trim() || null

    if (isNew) {
      // Just upsert description metadata — the category "exists" once a product uses it
      await supabase.from('categories').upsert({ name, description }, { onConflict: 'name' })
      setToast('Kategorie hinzugefügt')
      closePanel()
    } else if (selected) {
      const oldName = selected.name
      await Promise.all([
        // Update description metadata
        supabase.from('categories').upsert({ name, description }, { onConflict: 'name' }),
        // Rename category on all products if name changed
        oldName !== name
          ? supabase.from('products').update({ category: name }).eq('category', oldName)
          : Promise.resolve(null),
        // Clean up old entry if renamed
        oldName !== name
          ? supabase.from('categories').delete().eq('name', oldName)
          : Promise.resolve(null),
      ])
      setToast('Kategorie gespeichert')
      await load()
      closePanel()
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    if (selected.productCount > 0) {
      setToast(`Nicht möglich: ${selected.productCount} Artikel sind dieser Kategorie zugeordnet`)
      setConfirmDelete(false)
      return
    }
    await supabase.from('categories').delete().eq('name', selected.name)
    setToast('Kategorie gelöscht')
    await load()
    closePanel()
  }

  const filtered = categories.filter(c =>
    query === '' ||
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(query.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const panelOpen = isNew || selected != null

  return (
    <div className="flex-1 flex flex-col overflow-hidden pb-20 md:pb-0 relative">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {confirmDelete && selected && (
        <ConfirmDialog
          message={`Kategorie „${selected.name}" wirklich löschen?`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {/* Toolbar */}
      <div className="px-4 pt-3 pb-3 flex gap-2 items-center shrink-0">
        <div className="relative w-52 shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Suchen…"
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1) }}
            className="w-full border border-slate-200 rounded-xl pl-8 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-400"
          />
          {query && (
            <button onClick={() => { setQuery(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>
        <button onClick={openNew}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium shrink-0">
          <span className="hidden sm:inline text-sm">+ Neue Kategorie</span>
          <span className="sm:hidden text-sm">+</span>
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            <div className="hidden md:grid border-b border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 sticky top-0 z-10" style={{ gridTemplateColumns: '2fr 0.6fr 0.6fr 2rem' }}>
              {['Kategorie', 'Artikel', 'Lieferanten'].map(h => (
                <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{h}</div>
              ))}
              <div />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {paginated.map(c => (
                <div key={c.name} onClick={() => openExisting(c)} className="bg-white hover:bg-slate-50 dark:bg-slate-800/50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors">
                  <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '2fr 0.6fr 0.6fr 2rem' }}>
                    <div className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                      {c.description && <p className="text-xs text-slate-400 truncate mt-0.5">{c.description}</p>}
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">{c.productCount}</div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">{c.supplierCount}</div>
                    <div className="py-3.5 text-slate-300 dark:text-slate-600"><ChevronRight size={14} /></div>
                  </div>
                  <div className="flex md:hidden items-center px-4 py-3.5 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                      {c.description && <p className="text-xs text-slate-400 truncate mt-0.5">{c.description}</p>}
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{c.productCount} Artikel · {c.supplierCount} Lief.</span>
                    <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                  </div>
                </div>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-16">Keine Kategorien gefunden</p>
            )}
          </div>

          {/* Pagination — always visible at bottom */}
          <div className="flex items-center px-4 py-3 border-t border-slate-100 bg-white dark:bg-slate-800 dark:border-slate-700 shrink-0">
            <p className="text-xs text-slate-400 w-40 shrink-0">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} von {filtered.length} Kategorien
            </p>
            <div className="flex-1 flex items-center justify-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Zurück</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                .reduce<(number | '…')[]>((acc, n, i, arr) => {
                  if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push('…')
                  acc.push(n)
                  return acc
                }, [])
                .map((n, i) =>
                  n === '…' ? (
                    <span key={`e-${i}`} className="px-2 py-1.5 text-xs text-slate-300">…</span>
                  ) : (
                    <button key={n} onClick={() => setPage(n as number)}
                      className={`w-9 h-9 text-xs rounded-lg transition-colors ${page === n ? 'bg-sky-500 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                      {n}
                    </button>
                  )
                )
              }
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Weiter</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">»</button>
            </div>
            <div className="w-40 shrink-0" />
          </div>
        </div>
      )}

      {(panelOpen || closing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white dark:bg-slate-800 z-50 flex flex-col md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
              <h2 className="font-semibold text-slate-800 dark:text-slate-100 truncate flex-1 mr-2">
                {isNew ? 'Neue Kategorie' : selected?.name}
              </h2>
              <button onClick={closePanel}
                className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-1.5 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* View mode */}
            {!editing && !isNew ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Name</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100">{selected?.name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Artikel</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100">{selected?.productCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Lieferanten</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100">{selected?.supplierCount ?? 0}</p>
                  </div>
                </div>
                {selected?.description && (
                  <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                    <p className="text-xs text-slate-400 mb-0.5">Beschreibung</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">{selected.description}</p>
                  </div>
                )}
              </div>
            ) : (
              /* Edit / New mode */
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Name</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="z.B. Desinfektion" autoFocus className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Beschreibung</label>
                  <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optionale Beschreibung…" className={`${inputCls} resize-none`} />
                </div>
              </div>
            )}

            {!editing && !isNew ? (
              <div className="border-t border-slate-100 dark:border-slate-700 px-5 py-4 flex gap-3 shrink-0">
                <button onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  <Pencil size={14} /> Bearbeiten
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  <Trash2 size={14} /> Löschen
                </button>
              </div>
            ) : (editing || isNew) ? (
              <div className="border-t border-slate-100 dark:border-slate-700 px-5 py-4 flex gap-3 shrink-0">
                <button onClick={closePanel}
                  className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Abbrechen</button>
                <button onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  {saving ? 'Speichern…' : 'Speichern'}
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
