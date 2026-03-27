import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Search, X, Trash2, ChevronRight, ExternalLink, Pencil, Plus } from 'lucide-react'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

interface SupplierRow {
  name: string
  website: string | null
  notes: string | null
  min_order_value: number | null
  search_paths: string[]
  is_active: boolean
  productCount: number
  lastPurchaseAt: string | null
}

const inputCls = 'w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400'

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SupplierRow | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<{ name: string; website: string; notes: string; min_order_value: string; search_paths: string[]; is_active: boolean }>({
    name: '', website: '', notes: '', min_order_value: '', search_paths: [], is_active: true,
  })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [undoSupplier, setUndoSupplier] = useState<{ name: string; website: string | null; notes: string | null; min_order_value: number | null; search_paths: string[]; is_active: boolean; productIds: string[] } | null>(null)
  const [page, setPage] = useState(1)
  const [detecting, setDetecting] = useState(false)
  const [testQuery, setTestQuery] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ found: true; name: string | null; price: number; url: string } | { found: false; error?: string; debug?: { fetchedUrl: string; htmlBytes: number; rawProducts: { name: string | null; price: number }[] } } | null>(null)
  const PAGE_SIZE = 25

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: productRows }, { data: metaRows }, { data: orderItemRows }] = await Promise.all([
      supabase.from('products').select('id, preferred_supplier'),
      supabase.from('suppliers').select('name, website, notes, min_order_value, search_paths, is_active'),
      supabase.from('order_items')
        .select('product_id, orders!inner(created_at)')
        .eq('orders.status', 'received'),
    ])

    // Unique supplier names from products
    const namesFromProducts = new Set(
      (productRows ?? [])
        .map(p => (p.preferred_supplier as string | null)?.trim())
        .filter(Boolean) as string[]
    )

    // All names: union of product suppliers and standalone suppliers table entries
    const metaList = (metaRows ?? []) as { name: string; website: string | null; notes: string | null; min_order_value: number | null; search_paths: string[] | null; is_active: boolean | null }[]
    const allNames = [...new Set([...namesFromProducts, ...metaList.map(r => r.name)])].sort((a, b) => a.localeCompare(b))

    const websiteMap: Record<string, string | null> = {}
    const notesMap: Record<string, string | null> = {}
    const minOrderMap: Record<string, number | null> = {}
    const searchPathsMap: Record<string, string[]> = {}
    const isActiveMap: Record<string, boolean> = {}
    for (const r of metaList) {
      websiteMap[r.name] = r.website
      notesMap[r.name] = r.notes
      minOrderMap[r.name] = r.min_order_value
      searchPathsMap[r.name] = r.search_paths ?? []
      isActiveMap[r.name] = r.is_active ?? true
    }

    const productCounts: Record<string, number> = {}
    const productToSupplier: Record<string, string> = {}
    for (const p of (productRows ?? []) as { id: string; preferred_supplier: string | null }[]) {
      const s = p.preferred_supplier?.trim()
      if (s) {
        productCounts[s] = (productCounts[s] ?? 0) + 1
        productToSupplier[p.id] = s
      }
    }

    const lastPurchase: Record<string, string> = {}
    for (const item of (orderItemRows ?? []) as unknown as { product_id: string; orders: { created_at: string } }[]) {
      const supplier = productToSupplier[item.product_id]
      if (!supplier) continue
      const date = item.orders.created_at
      if (!lastPurchase[supplier] || date > lastPurchase[supplier]) lastPurchase[supplier] = date
    }

    setSuppliers(allNames.map(name => ({
      name,
      website: websiteMap[name] ?? null,
      notes: notesMap[name] ?? null,
      min_order_value: minOrderMap[name] ?? null,
      search_paths: searchPathsMap[name] ?? [],
      is_active: isActiveMap[name] ?? true,
      productCount: productCounts[name] ?? 0,
      lastPurchaseAt: lastPurchase[name] ?? null,
    })))
    setLoading(false)
  }

  function openNew() {
    setForm({ name: '', website: '', notes: '', min_order_value: '', search_paths: [], is_active: true })
    setSelected(null)
    setIsNew(true)
    setEditing(true)
    setConfirmDelete(false)
    setTestResult(null)
    setTestQuery('')
  }

  function openExisting(s: SupplierRow) {
    setForm({
      name: s.name,
      website: s.website ?? '',
      notes: s.notes ?? '',
      min_order_value: s.min_order_value != null ? String(s.min_order_value) : '',
      search_paths: s.search_paths,
      is_active: s.is_active,
    })
    setSelected(s)
    setIsNew(false)
    setEditing(false)
    setConfirmDelete(false)
    setTestResult(null)
    setTestQuery('')
  }

  function closePanel() {
    setClosing(true)
    setTimeout(() => {
      setSelected(null)
      setIsNew(false)
      setEditing(false)
      setForm({ name: '', website: '', notes: '', min_order_value: '', search_paths: [], is_active: true })
      setConfirmDelete(false)
      setClosing(false)
      setTestResult(null)
      setTestQuery('')
    }, 260)
  }

  async function handleSave() {
    const newName = form.name.trim()
    if (!newName) return
    setSaving(true)
    const oldName = isNew ? null : selected?.name
    const website = form.website.trim() || null
    const notes = form.notes.trim() || null
    const min_order_value = form.min_order_value.trim() ? parseFloat(form.min_order_value) : null
    const payload = { name: newName, website, notes, min_order_value, search_paths: form.search_paths, is_active: form.is_active }
    if (!isNew && oldName && oldName !== newName) {
      // Rename: insert new row, update products (match by name OR domain variant), delete old row
      const { error } = await supabase.from('suppliers').upsert(payload, { onConflict: 'name' })
      if (error) { setToast(`Fehler: ${error.message}`); setSaving(false); return }
      await supabase.from('products').update({ preferred_supplier: newName }).eq('preferred_supplier', oldName)
      if (website) {
        try {
          const domain = new URL(website).hostname.replace(/^www\./, '')
          if (domain !== oldName) {
            await supabase.from('products').update({ preferred_supplier: newName }).eq('preferred_supplier', domain)
          }
        } catch { /* invalid URL */ }
      }
      await supabase.from('suppliers').delete().eq('name', oldName)
    } else {
      const { error } = await supabase.from('suppliers').upsert(payload, { onConflict: 'name' })
      if (error) { setToast(`Fehler: ${error.message}`); setSaving(false); return }
    }
    setToast('Lieferant gespeichert')
    await load()
    closePanel()
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    const { data: affected } = await supabase.from('products').select('id').eq('preferred_supplier', selected.name)
    const snapshot = { ...selected, productIds: (affected ?? []).map(p => p.id) }
    const [{ error: prodError }, { error: supError }] = await Promise.all([
      supabase.from('products').update({ preferred_supplier: null }).eq('preferred_supplier', selected.name),
      supabase.from('suppliers').delete().eq('name', selected.name),
    ])
    if (prodError || supError) { setToast(`Fehler beim Löschen: ${(prodError ?? supError)?.message}`); return }
    setUndoSupplier(snapshot)
    setToast('Lieferant gelöscht')
    await load()
    closePanel()
  }

  async function handleUndoDelete() {
    if (!undoSupplier) return
    await Promise.all([
      supabase.from('suppliers').upsert(
        { name: undoSupplier.name, website: undoSupplier.website, notes: undoSupplier.notes, min_order_value: undoSupplier.min_order_value, search_paths: undoSupplier.search_paths, is_active: undoSupplier.is_active },
        { onConflict: 'name' }
      ),
      undoSupplier.productIds.length > 0
        ? supabase.from('products').update({ preferred_supplier: undoSupplier.name }).in('id', undoSupplier.productIds)
        : Promise.resolve(),
    ])
    setUndoSupplier(null)
    await load()
  }

  async function handleDetect() {
    if (!form.website.trim()) return
    setDetecting(true)
    try {
      const res = await fetch('/api/detect-search-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: form.website }),
      })
      const data = await res.json()
      if (data.detected) setForm(f => ({ ...f, search_paths: [data.detected] }))
      else setToast(data.error ?? 'Kein Suchformular gefunden')
    } catch { setToast('Fehler bei der Erkennung') }
    setDetecting(false)
  }

  async function handleTest() {
    if (!testQuery.trim() || !form.search_paths.length) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/test-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchUrl: form.search_paths[0], query: testQuery }),
      })
      setTestResult(await res.json())
    } catch { setTestResult({ found: false, error: 'Netzwerkfehler' }) }
    setTesting(false)
  }

  const filtered = suppliers.filter(s =>
    query === '' || s.name.toLowerCase().includes(query.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const panelOpen = isNew || selected != null

  return (
    <div className="flex-1 flex flex-col overflow-hidden pb-20 md:pb-0 relative">
      {toast && <Toast message={toast} onClose={() => { setToast(null); setUndoSupplier(null) }} onUndo={undoSupplier ? handleUndoDelete : undefined} />}
      {confirmDelete && selected && (
        <ConfirmDialog
          message={selected.productCount > 0 ? `Lieferant „${selected.name}" löschen? Bei ${selected.productCount} Artikel wird der Lieferant entfernt.` : `Lieferant „${selected.name}" löschen?`}
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
          <span className="hidden sm:inline">Neuer Lieferant</span>
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
            <div className="hidden md:grid border-b border-slate-200 bg-white sticky top-0 z-10 dark:bg-slate-800 dark:border-slate-700" style={{ gridTemplateColumns: '1.5fr 1.5fr 0.6fr 1fr 0.7fr 2rem' }}>
              {['Lieferant', 'Website', 'Artikel', 'Letzter Einkauf', 'Preisvergleich'].map(h => (
                <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide dark:text-slate-500">{h}</div>
              ))}
              <div />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {paginated.map(s => (
                <div key={s.name} onClick={() => openExisting(s)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors dark:bg-slate-800/50 dark:hover:bg-slate-700/50">
                  {/* Desktop */}
                  <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '1.5fr 1.5fr 0.6fr 1fr 0.7fr 2rem' }}>
                    <div className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{s.name}</p>
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400 truncate">
                      {s.website ? s.website.replace(/^https?:\/\/(www\.)?/, '') : '—'}
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">{s.productCount}</div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">
                      {s.lastPurchaseAt ? new Date(s.lastPurchaseAt).toLocaleDateString('de-DE') : '—'}
                    </div>
                    <div className="px-4 py-3.5">
                      {s.search_paths.length > 0 ? (
                        <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${s.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                          {s.is_active ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </div>
                    <div className="py-3.5 text-slate-300 dark:text-slate-600"><ChevronRight size={14} /></div>
                  </div>
                  {/* Mobile */}
                  <div className="flex md:hidden items-center px-4 py-3.5 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">{s.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {s.productCount} Artikel
                        {s.lastPurchaseAt ? ` · ${new Date(s.lastPurchaseAt).toLocaleDateString('de-DE')}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 shrink-0 dark:text-slate-600" />
                  </div>
                </div>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-16">Keine Lieferanten gefunden</p>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center px-4 py-3 border-t border-slate-100 bg-white shrink-0 dark:bg-slate-800 dark:border-slate-700">
            <p className="text-xs text-slate-400 w-40 shrink-0">
              {filtered.length === 0 ? '0' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)}`} von {filtered.length} Lieferanten
            </p>
            <div className="flex-1 flex items-center justify-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors dark:text-slate-400 dark:hover:bg-slate-700">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors dark:text-slate-400 dark:hover:bg-slate-700">Zurück</button>
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
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors dark:text-slate-400 dark:hover:bg-slate-700">Weiter</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-2.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors dark:text-slate-400 dark:hover:bg-slate-700">»</button>
            </div>
            <div className="w-40 shrink-0" />
          </div>
        </div>
      )}

      {/* Detail panel */}
      {(panelOpen || closing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white z-50 flex flex-col md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl dark:bg-slate-800 ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0 dark:border-slate-700">
              <h2 className="font-semibold text-slate-800 truncate flex-1 mr-2 dark:text-slate-100">
                {isNew ? 'Neuer Lieferant' : selected?.name}
              </h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1.5 transition-colors dark:text-slate-500 dark:hover:text-slate-300">
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
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Mindestbestellwert</p>
                    <p className="text-sm text-slate-800 dark:text-slate-100">
                      {selected?.min_order_value != null ? `€ ${Number(selected.min_order_value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                </div>
                {selected && selected.search_paths.length > 0 && (
                  <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs text-slate-400">Such-URLs (Preisvergleich)</p>
                      <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${selected.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                        {selected.is_active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {selected.search_paths.map((p, i) => (
                        <p key={i} className="text-xs font-mono text-slate-600 bg-slate-50 rounded px-2 py-1 break-all dark:bg-slate-700/50 dark:text-slate-300">{p}</p>
                      ))}
                    </div>
                  </div>
                )}
                {selected?.notes && (
                  <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
                    <p className="text-xs text-slate-400 mb-0.5">Notizen</p>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap dark:text-slate-100">{selected.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              /* Edit mode */
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Name *</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="z.B. Henry Schein" className={inputCls} autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Website</label>
                  <div className="flex items-center gap-2">
                    <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                      placeholder="https://www.henryschein-dental.de" className={inputCls} autoFocus={!isNew} />
                    {form.website && (
                      <a href={form.website} target="_blank" rel="noopener noreferrer"
                        className="text-slate-400 hover:text-sky-500 transition-colors shrink-0">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Mindestbestellwert (€)</label>
                  <input type="number" min="0" step="0.01" value={form.min_order_value}
                    onChange={e => setForm(f => ({ ...f, min_order_value: e.target.value }))}
                    placeholder="z.B. 50.00" className={inputCls} />
                </div>

                {/* Price comparison section */}
                <div className="border-t border-slate-100 pt-4 space-y-3 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide dark:text-slate-400">Preisvergleich</p>
                    <label
                      title={form.search_paths.length === 0 ? 'Erst Such-URL hinzufügen' : undefined}
                      className={`flex items-center gap-2 select-none ${form.search_paths.length === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div
                        onClick={() => form.search_paths.length > 0 && setForm(f => ({ ...f, is_active: !f.is_active }))}
                        className={`relative w-9 h-5 rounded-full transition-colors ${form.search_paths.length === 0 ? 'cursor-not-allowed bg-slate-200' : `cursor-pointer ${form.is_active ? 'bg-sky-500' : 'bg-slate-200'}`}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form.is_active && form.search_paths.length > 0 ? 'left-4' : 'left-0.5'}`} />
                      </div>
                      <span className="text-xs text-slate-600 dark:text-slate-400">{form.is_active && form.search_paths.length > 0 ? 'Aktiv' : 'Inaktiv'}</span>
                    </label>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">Such-URLs <span className="font-normal text-slate-400">(eine pro Zeile, {'{q}'} = Suchbegriff)</span></label>
                      <button
                        type="button"
                        onClick={handleDetect}
                        disabled={!form.website.trim() || detecting}
                        className="text-xs text-sky-600 hover:text-sky-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                      >
                        {detecting
                          ? <><span className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin inline-block" /> Erkennen…</>
                          : '⚡ Auto-erkennen'}
                      </button>
                    </div>
                    <textarea rows={3}
                      value={form.search_paths.join('\n')}
                      onChange={e => setForm(f => ({ ...f, search_paths: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                      className={`${inputCls} resize-none font-mono`}
                      placeholder="https://example.com/search?q={q}" />
                  </div>

                  {/* Test */}
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Produktname zum Testen…"
                        value={testQuery}
                        onChange={e => { setTestQuery(e.target.value); setTestResult(null) }}
                        className={`${inputCls} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={handleTest}
                        disabled={!testQuery.trim() || !form.search_paths.length || testing}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                      >
                        {testing
                          ? <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
                          : 'Testen'}
                      </button>
                    </div>
                    {testResult && (
                      testResult.found ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-1 dark:bg-emerald-900/20 dark:border-emerald-800">
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Treffer gefunden</p>
                          {testResult.name && <p className="text-sm text-slate-700 dark:text-slate-300">{testResult.name}</p>}
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">€ {testResult.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          <a href={testResult.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 hover:underline break-all">{testResult.url}</a>
                        </div>
                      ) : (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1 dark:bg-slate-700/50 dark:border-slate-600">
                          <p className="text-sm text-slate-500 dark:text-slate-400">{testResult.error ?? 'Kein Treffer gefunden'}</p>
                          {!testResult.found && testResult.debug && (
                            <div className="text-xs text-slate-400 space-y-0.5 mt-1">
                              <p className="font-mono break-all">↳ {testResult.debug.fetchedUrl}</p>
                              <p>{testResult.debug.htmlBytes.toLocaleString()} bytes · {testResult.debug.rawProducts.length} Rohprodukte</p>
                              {testResult.debug.rawProducts.map((p, i) => (
                                <p key={i} className="font-mono">€{p.price} — {p.name ?? '(kein Name)'}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Notizen</label>
                  <textarea rows={3} value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Interne Notizen zum Lieferanten…" className={`${inputCls} resize-none`} />
                </div>
              </div>
            )}

            {!editing ? (
              <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0 dark:border-slate-700">
                <button onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-center gap-2 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                  <Pencil size={14} /> Bearbeiten
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  <Trash2 size={14} /> Löschen
                </button>
              </div>
            ) : (
              <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0 dark:border-slate-700">
                <button onClick={closePanel}
                  className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Abbrechen</button>
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
