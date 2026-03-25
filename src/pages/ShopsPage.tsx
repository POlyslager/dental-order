import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PriceComparisonShop } from '../lib/types'
import { Plus, Search, X, Trash2, ChevronRight, Pencil, ExternalLink } from 'lucide-react'
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
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [testQuery, setTestQuery] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ found: true; name: string | null; price: number; url: string } | { found: false; error?: string; debug?: { fetchedUrl: string; htmlBytes: number; rawProducts: { name: string | null; price: number }[] } } | null>(null)
  const [closing, setClosing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [undoShop, setUndoShop] = useState<PriceComparisonShop | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('price_comparison_shops').select('*').order('base_url')
    setShops((data ?? []) as PriceComparisonShop[])
    setLoading(false)
  }

  function openNew() {
    setForm({ base_url: '', search_paths: [''], is_active: true, notes: null, min_order_value: null })
    setSelected(null)
    setIsNew(true)
    setEditing(true)
    setConfirmDelete(false)
  }

  function openExisting(shop: PriceComparisonShop) {
    setForm({ ...shop })
    setSelected(shop)
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

  async function handleDetect() {
    if (!form.base_url?.trim()) return
    setDetecting(true)
    try {
      const res = await fetch('/api/detect-search-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: form.base_url }),
      })
      const data = await res.json()
      if (data.detected) setForm(f => ({ ...f, search_paths: [data.detected] }))
      else setToast(data.error ?? 'Kein Suchformular gefunden')
    } catch { setToast('Fehler bei der Erkennung') }
    setDetecting(false)
  }

  async function handleTest() {
    if (!testQuery.trim() || !(form.search_paths ?? []).length) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/test-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchUrl: form.search_paths![0], query: testQuery }),
      })
      setTestResult(await res.json())
    } catch { setTestResult({ found: false, error: 'Netzwerkfehler' }) }
    setTesting(false)
  }

  const filtered = shops.filter(s =>
    query === '' || s.base_url.toLowerCase().includes(query.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const panelOpen = isNew || selected != null

  return (
    <div className="flex-1 flex flex-col overflow-hidden pb-20 md:pb-0 relative">
      {toast && <Toast message={toast} onClose={() => { setToast(null); if (!undoShop) setUndoShop(null) }} onUndo={undoShop ? handleUndoDelete : undefined} />}
      {confirmDelete && (
        <ConfirmDialog
          message="Shop wirklich löschen?"
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
            className="w-full border border-slate-200 rounded-xl pl-8 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
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
          <span className="hidden sm:inline">Neuer Shop</span>
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
            {/* Desktop header */}
            <div className="hidden md:grid border-b border-slate-200 bg-white sticky top-0 z-10" style={{ gridTemplateColumns: '2fr 0.9fr 0.7fr 0.7fr 2rem' }}>
              {['URL', 'Min. Bestellwert', 'Such-Pfade', 'Status'].map(h => (
                <div key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</div>
              ))}
              <div />
            </div>
            <div className="divide-y divide-slate-100">
              {paginated.map(shop => (
                <div key={shop.id} onClick={() => openExisting(shop)} className="bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                  {/* Desktop */}
                  <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '2fr 0.9fr 0.7fr 0.7fr 2rem' }}>
                    <div className="px-4 py-3.5 text-sm font-semibold text-slate-800 truncate">{displayUrl(shop.base_url)}</div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">
                      {shop.min_order_value != null ? `€ ${shop.min_order_value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </div>
                    <div className="px-4 py-3.5 text-sm text-slate-400">
                      {shop.search_paths.length}
                    </div>
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
          </div>

          {/* Pagination — always visible at bottom */}
          <div className="flex items-center px-4 py-3 border-t border-slate-100 bg-white shrink-0">
            <p className="text-xs text-slate-400 w-40 shrink-0">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} von {filtered.length}
            </p>
            <div className="flex-1 flex items-center justify-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Zurück</button>
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
                      className={`w-8 h-7 text-xs rounded-lg transition-colors ${page === n ? 'bg-sky-500 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                      {n}
                    </button>
                  )
                )
              }
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Weiter</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">»</button>
            </div>
            <div className="w-40 shrink-0" />
          </div>
        </div>
      )}

      {/* Detail panel */}
      {(panelOpen || closing) && (
        <>
          <div className="hidden md:block fixed inset-0 bg-black/30 z-40" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white z-50 flex flex-col overflow-y-auto md:inset-auto md:top-4 md:bottom-4 md:right-4 md:w-[520px] md:rounded-2xl md:shadow-2xl md:overflow-hidden ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="font-semibold text-slate-800 truncate flex-1 mr-2">
                {isNew ? 'Neuer Shop' : (form.base_url ? displayUrl(form.base_url) : 'Shop')}
              </h2>
              <button onClick={closePanel}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* View mode */}
            {!editing ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Basis-URL</p>
                  <a href={form.base_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-sky-600 hover:underline break-all">
                    <ExternalLink size={12} /> {form.base_url}
                  </a>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Status</p>
                  <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${form.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {form.is_active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </div>
                {form.min_order_value != null && (
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Mindestbestellwert</p>
                    <p className="text-sm text-slate-800">€ {Number(form.min_order_value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                )}
                {form.notes && (
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Notizen</p>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{form.notes}</p>
                  </div>
                )}
                {(form.search_paths ?? []).length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Such-URLs</p>
                    <div className="space-y-1">
                      {(form.search_paths ?? []).map((p, i) => (
                        <p key={i} className="text-xs font-mono text-slate-600 bg-slate-50 rounded px-2 py-1 break-all">{p}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Edit mode */
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <Field label="Basis-URL">
                  <input type="url" placeholder="https://www.henryschein-dental.de"
                    value={form.base_url ?? ''} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                    className={inputCls} autoFocus={isNew} />
                </Field>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-600">Such-URLs (eine pro Zeile, {'{q}'} = Suchbegriff)</label>
                    <button
                      type="button"
                      onClick={handleDetect}
                      disabled={!form.base_url?.trim() || detecting}
                      className="text-xs text-sky-600 hover:text-sky-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                    >
                      {detecting
                        ? <><span className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin inline-block" /> Erkennen…</>
                        : '⚡ Auto-erkennen'}
                    </button>
                  </div>
                  <textarea rows={4}
                    value={(form.search_paths ?? []).join('\n')}
                    onChange={e => setForm(f => ({ ...f, search_paths: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                    className={`${inputCls} resize-none font-mono`}
                    placeholder="https://example.com/search?q={q}" />
                </div>

                {/* Test section */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Verbindung testen</p>
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
                      disabled={!testQuery.trim() || !(form.search_paths ?? []).length || testing}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      {testing
                        ? <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
                        : 'Testen'}
                    </button>
                  </div>
                  {testResult && (
                    testResult.found ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-1">
                        <p className="text-xs font-semibold text-emerald-700">Treffer gefunden</p>
                        {testResult.name && <p className="text-sm text-slate-700">{testResult.name}</p>}
                        <p className="text-sm font-bold text-slate-800">€ {testResult.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <a href={testResult.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 hover:underline break-all">{testResult.url}</a>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1">
                        <p className="text-sm text-slate-500">{testResult.error ?? 'Kein Treffer gefunden'}</p>
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

              </div>
            )}

            {/* Footer */}
            {!editing && !isNew ? (
              <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
                <button onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-center gap-2 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  <Pencil size={14} /> Bearbeiten
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                  <Trash2 size={14} /> Löschen
                </button>
              </div>
            ) : editing ? (
              <div className="border-t border-slate-100 px-5 py-4 flex gap-3 shrink-0">
                <button onClick={closePanel}
                  className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  Abbrechen
                </button>
                <button onClick={handleSave} disabled={saving || !form.base_url?.trim()}
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
