import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Search, X, Trash2, ChevronRight, ExternalLink, Pencil, Plus } from 'lucide-react'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { useIsDesktop } from '../hooks/useIsDesktop'

interface BrandRow {
  name: string
  website: string | null
  notes: string | null
  productCount: number
}

const inputCls = 'w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400'

export default function BrandsPage() {
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BrandRow | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<{ name: string; website: string; notes: string }>({ name: '', website: '', notes: '' })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [undoBrand, setUndoBrand] = useState<{ name: string; website: string | null; notes: string | null; productIds: string[] } | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25
  const isDesktop = useIsDesktop()

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: productRows }, { data: metaRows }] = await Promise.all([
      supabase.from('products').select('id, brand').not('brand', 'is', null),
      supabase.from('brands').select('name, website, notes'),
    ])

    const metaList = (metaRows ?? []) as { name: string; website: string | null; notes: string | null }[]

    const websiteMap: Record<string, string | null> = {}
    const notesMap: Record<string, string | null> = {}
    for (const r of metaList) {
      websiteMap[r.name] = r.website
      notesMap[r.name] = r.notes
    }

    const productCounts: Record<string, number> = {}
    for (const p of (productRows ?? []) as { id: string; brand: string | null }[]) {
      const b = p.brand?.trim()
      if (b) productCounts[b] = (productCounts[b] ?? 0) + 1
    }

    const namesFromProducts = (productRows ?? []).map(p => (p.brand as string | null)?.trim()).filter(Boolean) as string[]
    const names = [...new Set([...namesFromProducts, ...metaList.map(r => r.name)])].sort((a, b) => a.localeCompare(b))

    setBrands(names.map(name => ({
      name,
      website: websiteMap[name] ?? null,
      notes: notesMap[name] ?? null,
      productCount: productCounts[name] ?? 0,
    })))
    setLoading(false)
  }

  function openNew() {
    setForm({ name: '', website: '', notes: '' })
    setSelected(null)
    setIsNew(true)
    setEditing(true)
    setConfirmDelete(false)
  }

  function openExisting(b: BrandRow) {
    setForm({ name: b.name, website: b.website ?? '', notes: b.notes ?? '' })
    setSelected(b)
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
      setForm({ name: '', website: '', notes: '' })
      setConfirmDelete(false)
      setClosing(false)
    }, 260)
  }

  async function handleSave() {
    const name = isNew ? form.name.trim() : selected?.name
    if (!name) return
    setSaving(true)
    const website = form.website.trim() || null
    const notes = form.notes.trim() || null
    await supabase.from('brands').upsert({ name, website, notes }, { onConflict: 'name' })
    setToast('Hersteller gespeichert')
    await load()
    closePanel()
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    if (selected.productCount > 0) {
      setToast(`Nicht möglich: ${selected.productCount} Artikel sind diesem Hersteller zugeordnet`)
      setConfirmDelete(false)
      return
    }
    await supabase.from('brands').delete().eq('name', selected.name)
    setToast('Hersteller gelöscht')
    await load()
    closePanel()
  }

  async function handleUndoDelete() {
    if (!undoBrand) return
    await Promise.all([
      supabase.from('brands').upsert({ name: undoBrand.name, website: undoBrand.website, notes: undoBrand.notes }, { onConflict: 'name' }),
      undoBrand.productIds.length > 0
        ? supabase.from('products').update({ brand: undoBrand.name }).in('id', undoBrand.productIds)
        : Promise.resolve(),
    ])
    setUndoBrand(null)
    await load()
  }

  const filtered = brands.filter(b =>
    query === '' || b.name.toLowerCase().includes(query.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const panelOpen = isNew || selected != null

  return (
    <div className="flex-1 flex flex-col overflow-hidden pb-20 md:pb-0 relative">
      {toast && <Toast message={toast} onClose={() => { setToast(null); setUndoBrand(null) }} onUndo={undoBrand ? handleUndoDelete : undefined} />}
      {confirmDelete && selected && (
        <ConfirmDialog
          message={`Hersteller „${selected.name}" löschen? Bei ${selected.productCount} Artikel wird der Hersteller entfernt.`}
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
        <button
          onClick={openNew}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium shrink-0"
        >
          <Plus size={16} />
          <span className={isDesktop ? 'inline' : 'hidden'}>Neuer Hersteller</span>
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex justify-center py-20">
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* Desktop header */}
            <div className={`${isDesktop ? 'grid' : 'hidden'} border-b border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 sticky top-0 z-10`} style={{ gridTemplateColumns: '1.5fr 1.5fr 0.6fr 2rem' }}>
              {['Hersteller', 'Website', 'Artikel'].map(h => (
                <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{h}</div>
              ))}
              <div />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {paginated.map(b => (
                <div key={b.name} onClick={() => openExisting(b)} className="bg-white hover:bg-slate-50 dark:bg-slate-800/50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors">
                  {/* Desktop */}
                  <div className={`${isDesktop ? 'grid' : 'hidden'} items-center`} style={{ gridTemplateColumns: '1.5fr 1.5fr 0.6fr 2rem' }}>
                    <div className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{b.name}</p>
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400 truncate">
                      {b.website ? b.website.replace(/^https?:\/\/(www\.)?/, '') : '—'}
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">{b.productCount}</div>
                    <div className="py-3.5 text-slate-300 dark:text-slate-600"><ChevronRight size={14} /></div>
                  </div>
                  {/* Mobile */}
                  <div className={`${isDesktop ? 'hidden' : 'flex'} items-center px-4 py-3.5 gap-3`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{b.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{b.productCount} Artikel</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                  </div>
                </div>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-16">Keine Hersteller gefunden</p>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center px-4 py-3 border-t border-slate-100 bg-white dark:bg-slate-800 dark:border-slate-700 shrink-0">
            <p className="text-xs text-slate-400 w-40 shrink-0">
              {filtered.length === 0 ? '0' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)}`} von {filtered.length} Herstellern
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

      {/* Detail panel */}
      {(panelOpen || closing) && (
        <>
          <div className={`${isDesktop ? 'block' : 'hidden'} fixed inset-0 bg-black/30 z-40`} onClick={closePanel} />
          <div className={`fixed bg-white dark:bg-slate-800 z-50 flex flex-col ${isDesktop ? 'inset-auto top-4 bottom-4 right-4 w-[520px] rounded-2xl shadow-2xl overflow-hidden' : 'inset-0 overflow-y-auto'} ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
              <h2 className="font-semibold text-slate-800 dark:text-slate-100 truncate flex-1 mr-2">
                {isNew ? 'Neuer Hersteller' : selected?.name}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-1.5 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* View mode */}
            {!editing ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Name</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100">{selected?.name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Website</p>
                    {selected?.website ? (
                      <a href={selected.website} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-sky-600 hover:underline break-all">
                        <ExternalLink size={12} /> {selected.website.replace(/^https?:\/\//, '')}
                      </a>
                    ) : <p className="text-sm text-slate-800 dark:text-slate-100">—</p>}
                  </div>
                </div>
                {selected?.notes && (
                  <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                    <p className="text-xs text-slate-400 mb-0.5">Notizen</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">{selected.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              /* Edit mode */
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {isNew && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Name *</label>
                    <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="z.B. Hager Werken" className={inputCls} autoFocus />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Website</label>
                  <div className="flex items-center gap-2">
                    <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                      placeholder="https://www.hagerwerken.de" className={inputCls} autoFocus={!isNew} />
                    {form.website && (
                      <a href={form.website} target="_blank" rel="noopener noreferrer"
                        className="text-slate-400 hover:text-sky-500 transition-colors shrink-0">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Notizen</label>
                  <textarea rows={3} value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Interne Notizen zum Hersteller…" className={`${inputCls} resize-none`} />
                </div>
              </div>
            )}

            {!editing ? (
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
            ) : (
              <div className="border-t border-slate-100 dark:border-slate-700 px-5 py-4 flex gap-3 shrink-0">
                <button onClick={closePanel}
                  className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Abbrechen</button>
                <button onClick={handleSave} disabled={saving || (isNew && !form.name.trim())}
                  className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  {saving ? 'Speichern…' : 'Speichern'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
