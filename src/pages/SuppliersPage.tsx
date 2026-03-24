import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Search, X, Trash2, RefreshCw, ChevronRight, ExternalLink } from 'lucide-react'

interface Supplier { id: string; name: string; website: string | null }
interface SupplierStats { productCount: number; lastPurchaseAt: string | null }

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm'

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [stats, setStats] = useState<Record<string, SupplierStats>>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<{ name: string; website: string }>({ name: '', website: '' })
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { loadWithSync() }, [])

  async function loadWithSync() {
    // Sync supplier names from products
    const { data: products } = await supabase.from('products').select('preferred_supplier').not('preferred_supplier', 'is', null)
    if (products) {
      const names = [...new Set(products.map(p => p.preferred_supplier as string))].filter(Boolean)
      if (names.length > 0) {
        const { data: existing } = await supabase.from('suppliers').select('name')
        const existingNames = new Set((existing ?? []).map((s: { name: string }) => s.name))
        const toInsert = names.filter(n => !existingNames.has(n))
        if (toInsert.length > 0) {
          await supabase.from('suppliers').insert(toInsert.map(n => ({ name: n })))
        }
      }
    }
    await load()
  }

  async function load() {
    const [{ data: supplierRows }, { data: productRows }, { data: orderItemRows }] = await Promise.all([
      supabase.from('suppliers').select('id, name, website').order('name'),
      supabase.from('products').select('preferred_supplier'),
      supabase.from('order_items')
        .select('product_id, orders!inner(created_at)')
        .eq('orders.status', 'received'),
    ])

    setSuppliers((supplierRows ?? []) as Supplier[])

    // Product count per supplier
    const productCounts: Record<string, number> = {}
    for (const p of (productRows ?? []) as { preferred_supplier: string | null }[]) {
      const s = p.preferred_supplier
      if (s) productCounts[s] = (productCounts[s] ?? 0) + 1
    }

    // Last purchase date per supplier — need to join order_items with products
    const { data: productSupplierRows } = await supabase
      .from('products').select('id, preferred_supplier').not('preferred_supplier', 'is', null)
    const productToSupplier: Record<string, string> = {}
    for (const p of (productSupplierRows ?? []) as { id: string; preferred_supplier: string }[]) {
      productToSupplier[p.id] = p.preferred_supplier
    }

    const lastPurchase: Record<string, string> = {}
    for (const item of (orderItemRows ?? []) as { product_id: string; orders: { created_at: string } }[]) {
      const supplier = productToSupplier[item.product_id]
      if (!supplier) continue
      const date = item.orders.created_at
      if (!lastPurchase[supplier] || date > lastPurchase[supplier]) {
        lastPurchase[supplier] = date
      }
    }

    const newStats: Record<string, SupplierStats> = {}
    for (const s of (supplierRows ?? []) as Supplier[]) {
      newStats[s.name] = {
        productCount: productCounts[s.name] ?? 0,
        lastPurchaseAt: lastPurchase[s.name] ?? null,
      }
    }
    setStats(newStats)
    setLoading(false)
  }

  async function syncFromProducts() {
    setSyncing(true)
    await loadWithSync()
    setSyncing(false)
  }

  function openNew() {
    setForm({ name: '', website: '' })
    setSelected(null)
    setIsNew(true)
    setConfirmDelete(false)
  }

  function openExisting(s: Supplier) {
    setForm({ name: s.name, website: s.website ?? '' })
    setSelected(s)
    setIsNew(false)
    setConfirmDelete(false)
  }

  function closePanel() {
    setClosing(true)
    setTimeout(() => {
      setSelected(null)
      setIsNew(false)
      setForm({ name: '', website: '' })
      setConfirmDelete(false)
      setClosing(false)
    }, 260)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = { name: form.name.trim(), website: form.website.trim() || null }
    if (isNew) {
      const { data } = await supabase.from('suppliers').insert(payload).select('id, name, website').single()
      if (data) {
        setSuppliers(s => [...s, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)))
        closePanel()
      }
    } else if (selected) {
      const oldName = selected.name
      const [{ data }] = await Promise.all([
        supabase.from('suppliers').update(payload).eq('id', selected.id).select('id, name, website').single(),
        oldName !== form.name.trim()
          ? supabase.from('products').update({ preferred_supplier: form.name.trim() }).eq('preferred_supplier', oldName)
          : Promise.resolve(null),
      ])
      if (data) {
        setSuppliers(s => s.map(x => x.id === selected.id ? data as Supplier : x).sort((a, b) => a.name.localeCompare(b.name)))
        closePanel()
        await load()
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
        <button onClick={syncFromProducts} disabled={syncing} title="Aus Produkten synchronisieren"
          className="p-2 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 bg-white">
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
        </button>
        <button onClick={openNew}
          className="ml-auto bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium shrink-0">
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
          <div className="hidden md:grid border-b border-slate-200 bg-white sticky top-0 z-10" style={{ gridTemplateColumns: '2fr 0.6fr 1fr 2rem' }}>
            {['Lieferant', 'Artikel', 'Letzter Einkauf'].map(h => (
              <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</div>
            ))}
            <div />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.map(s => {
              const st = stats[s.name]
              return (
                <div key={s.id} onClick={() => openExisting(s)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                  {/* Desktop */}
                  <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '2fr 0.6fr 1fr 2rem' }}>
                    <div className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                      {s.website && <p className="text-xs text-slate-400 truncate mt-0.5">{s.website.replace(/^https?:\/\//, '')}</p>}
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">{st?.productCount ?? 0}</div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">
                      {st?.lastPurchaseAt ? new Date(st.lastPurchaseAt).toLocaleDateString('de-DE') : '—'}
                    </div>
                    <div className="py-3.5 text-slate-300"><ChevronRight size={14} /></div>
                  </div>
                  {/* Mobile */}
                  <div className="flex md:hidden items-center px-4 py-3.5 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {st?.productCount ?? 0} Artikel
                        {st?.lastPurchaseAt ? ` · ${new Date(st.lastPurchaseAt).toLocaleDateString('de-DE')}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                  </div>
                </div>
              )
            })}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-16">Keine Lieferanten gefunden</p>
          )}
        </>
      )}

      {/* Detail panel */}
      {(panelOpen || closing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white z-50 flex flex-col overflow-y-auto md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl md:overflow-hidden ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">{isNew ? 'Neuer Lieferant' : 'Lieferant bearbeiten'}</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {selected && stats[selected.name] && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-400 mb-0.5">Artikel</p>
                    <p className="text-xl font-bold text-slate-800">{stats[selected.name].productCount}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-400 mb-0.5">Letzter Einkauf</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {stats[selected.name].lastPurchaseAt
                        ? new Date(stats[selected.name].lastPurchaseAt!).toLocaleDateString('de-DE')
                        : '—'}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="z.B. Henry Schein" autoFocus className={inputCls} />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Website</label>
                <div className="flex items-center gap-2">
                  <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                    placeholder="https://www.henryschein-dental.de" className={inputCls} />
                  {form.website && (
                    <a href={form.website} target="_blank" rel="noopener noreferrer"
                      className="text-slate-400 hover:text-sky-500 transition-colors shrink-0" onClick={e => e.stopPropagation()}>
                      <ExternalLink size={16} />
                    </a>
                  )}
                </div>
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
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
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
