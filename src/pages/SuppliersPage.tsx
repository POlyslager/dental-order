import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Search, X, Trash2, ChevronRight, ExternalLink } from 'lucide-react'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'

interface SupplierRow {
  name: string
  website: string | null
  notes: string | null
  min_order_value: number | null
  productCount: number
  lastPurchaseAt: string | null
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm'

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SupplierRow | null>(null)
  const [form, setForm] = useState<{ website: string; notes: string; min_order_value: string }>({ website: '', notes: '', min_order_value: '' })
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [undoSupplier, setUndoSupplier] = useState<{ name: string; website: string | null; notes: string | null; min_order_value: number | null; productIds: string[] } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    // Source of truth for supplier names is products.preferred_supplier
    const [{ data: productRows }, { data: websiteRows }, { data: orderItemRows }] = await Promise.all([
      supabase.from('products').select('preferred_supplier'),
      supabase.from('suppliers').select('name, website, notes, min_order_value'),
      supabase.from('order_items')
        .select('product_id, orders!inner(created_at)')
        .eq('orders.status', 'received'),
    ])

    // Unique supplier names from products
    const names = [...new Set(
      (productRows ?? [])
        .map(p => (p.preferred_supplier as string | null)?.trim())
        .filter(Boolean) as string[]
    )].sort((a, b) => a.localeCompare(b))

    // Metadata lookup from suppliers table
    const websiteMap: Record<string, string | null> = {}
    const notesMap: Record<string, string | null> = {}
    const minOrderMap: Record<string, number | null> = {}
    for (const r of (websiteRows ?? []) as { name: string; website: string | null; notes: string | null; min_order_value: number | null }[]) {
      websiteMap[r.name] = r.website
      notesMap[r.name] = r.notes
      minOrderMap[r.name] = r.min_order_value
    }

    // Product count per supplier
    const productCounts: Record<string, number> = {}
    for (const p of (productRows ?? []) as { preferred_supplier: string | null }[]) {
      const s = p.preferred_supplier?.trim()
      if (s) productCounts[s] = (productCounts[s] ?? 0) + 1
    }

    // Last purchase date: need products id→supplier map first
    const { data: productIdRows } = await supabase
      .from('products').select('id, preferred_supplier').not('preferred_supplier', 'is', null)
    const productToSupplier: Record<string, string> = {}
    for (const p of (productIdRows ?? []) as { id: string; preferred_supplier: string }[]) {
      if (p.preferred_supplier?.trim()) productToSupplier[p.id] = p.preferred_supplier.trim()
    }

    const lastPurchase: Record<string, string> = {}
    for (const item of (orderItemRows ?? []) as unknown as { product_id: string; orders: { created_at: string } }[]) {
      const supplier = productToSupplier[item.product_id]
      if (!supplier) continue
      const date = item.orders.created_at
      if (!lastPurchase[supplier] || date > lastPurchase[supplier]) lastPurchase[supplier] = date
    }

    setSuppliers(names.map(name => ({
      name,
      website: websiteMap[name] ?? null,
      notes: notesMap[name] ?? null,
      min_order_value: minOrderMap[name] ?? null,
      productCount: productCounts[name] ?? 0,
      lastPurchaseAt: lastPurchase[name] ?? null,
    })))
    setLoading(false)
  }

  function openExisting(s: SupplierRow) {
    setForm({ website: s.website ?? '', notes: s.notes ?? '', min_order_value: s.min_order_value != null ? String(s.min_order_value) : '' })
    setSelected(s)
    setConfirmDelete(false)
  }

  function closePanel() {
    setClosing(true)
    setTimeout(() => {
      setSelected(null)
      setForm({ website: '', notes: '', min_order_value: '' })
      setConfirmDelete(false)
      setClosing(false)
    }, 260)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    const website = form.website.trim() || null
    const notes = form.notes.trim() || null
    const min_order_value = form.min_order_value.trim() ? parseFloat(form.min_order_value) : null
    await supabase.from('suppliers').upsert(
      { name: selected.name, website, notes, min_order_value },
      { onConflict: 'name' }
    )
    setSuppliers(s => s.map(x => x.name === selected.name ? { ...x, website, notes, min_order_value } : x))
    setToast('Lieferant gespeichert')
    closePanel()
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    const { data: affected } = await supabase.from('products').select('id').eq('preferred_supplier', selected.name)
    const snapshot = { name: selected.name, website: selected.website, notes: selected.notes, min_order_value: selected.min_order_value, productIds: (affected ?? []).map(p => p.id) }
    await Promise.all([
      supabase.from('products').update({ preferred_supplier: null }).eq('preferred_supplier', selected.name),
      supabase.from('suppliers').delete().eq('name', selected.name),
    ])
    setUndoSupplier(snapshot)
    setToast('Lieferant gelöscht')
    await load()
    closePanel()
  }

  async function handleUndoDelete() {
    if (!undoSupplier) return
    await Promise.all([
      supabase.from('suppliers').upsert({ name: undoSupplier.name, website: undoSupplier.website, notes: undoSupplier.notes, min_order_value: undoSupplier.min_order_value }, { onConflict: 'name' }),
      undoSupplier.productIds.length > 0
        ? supabase.from('products').update({ preferred_supplier: undoSupplier.name }).in('id', undoSupplier.productIds)
        : Promise.resolve(),
    ])
    setUndoSupplier(null)
    await load()
  }

  const filtered = suppliers.filter(s =>
    query === '' || s.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="w-full relative">
      {toast && <Toast message={toast} onClose={() => { setToast(null); setUndoSupplier(null) }} onUndo={undoSupplier ? handleUndoDelete : undefined} />}
      {confirmDelete && selected && (
        <ConfirmDialog
          message={`Lieferant „${selected.name}" löschen? Bei ${selected.productCount} Artikel wird der Lieferant entfernt.`}
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

          <div className="divide-y divide-slate-100">
            {filtered.map(s => (
              <div key={s.name} onClick={() => openExisting(s)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                {/* Desktop */}
                <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '2fr 0.6fr 1fr 2rem' }}>
                  <div className="px-4 py-3.5">
                    <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                    {s.website && <p className="text-xs text-slate-400 truncate mt-0.5">{s.website.replace(/^https?:\/\//, '')}</p>}
                  </div>
                  <div className="px-4 py-3.5 text-sm text-slate-400">{s.productCount}</div>
                  <div className="px-4 py-3.5 text-sm text-slate-400">
                    {s.lastPurchaseAt ? new Date(s.lastPurchaseAt).toLocaleDateString('de-DE') : '—'}
                  </div>
                  <div className="py-3.5 text-slate-300"><ChevronRight size={14} /></div>
                </div>
                {/* Mobile */}
                <div className="flex md:hidden items-center px-4 py-3.5 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {s.productCount} Artikel
                      {s.lastPurchaseAt ? ` · ${new Date(s.lastPurchaseAt).toLocaleDateString('de-DE')}` : ''}
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-16">Keine Lieferanten gefunden</p>
          )}
        </>
      )}

      {/* Detail panel */}
      {(!!selected || closing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white z-50 flex flex-col md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800">{selected?.name}</h2>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {selected && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-400 mb-0.5">Artikel</p>
                    <p className="text-xl font-bold text-slate-800">{selected.productCount}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-400 mb-0.5">Letzter Einkauf</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {selected.lastPurchaseAt
                        ? new Date(selected.lastPurchaseAt).toLocaleDateString('de-DE')
                        : '—'}
                    </p>
                  </div>
                </div>
              )}

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

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mindestbestellwert (€)</label>
                <input type="number" min="0" step="0.01" value={form.min_order_value}
                  onChange={e => setForm(f => ({ ...f, min_order_value: e.target.value }))}
                  placeholder="z.B. 50.00" className={inputCls} />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notizen</label>
                <textarea rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Interne Notizen zum Lieferanten…" className={`${inputCls} resize-none`} />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors">
                  <Trash2 size={14} /> Lieferant löschen
                </button>
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
              <button onClick={closePanel}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Abbrechen</button>
              <button onClick={handleSave} disabled={saving}
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
