import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Download, Upload, FileText, Check, AlertCircle } from 'lucide-react'

function downloadCSV(filename: string, rows: string[][]) {
  const content = rows.map(r => r.map(cell =>
    typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
      ? `"${cell.replace(/"/g, '""')}"` : cell
  ).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + content, ], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values: string[] = []
    let current = ''; let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { values.push(current.trim()); current = '' }
      else { current += ch }
    }
    values.push(current.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
}

type ToastType = 'success' | 'error'

export default function DataPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null)

  function showToast(msg: string, type: ToastType = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function exportProducts() {
    const { data } = await supabase.from('products')
      .select('name,barcode,category,current_stock,min_stock,unit,preferred_supplier,last_price,notes,treatment_types,expiry_date,lot_number,created_at')
      .order('name')
    if (!data) return
    const headers = ['Name', 'Barcode', 'Kategorie', 'Bestand', 'Mindestbestand', 'Einheit', 'Lieferant', 'Preis', 'Notizen', 'Behandlungstypen', 'Verfallsdatum', 'Chargennummer', 'Erstellt am']
    const rows = data.map(p => [
      p.name, p.barcode ?? '', p.category, String(p.current_stock), String(p.min_stock),
      p.unit, p.preferred_supplier ?? '', p.last_price != null ? String(p.last_price) : '',
      p.notes ?? '', (p.treatment_types ?? []).join(';'), p.expiry_date ?? '', p.lot_number ?? '',
      p.created_at ? new Date(p.created_at).toLocaleDateString('de-DE') : '',
    ])
    downloadCSV(`produkte_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows])
  }

  async function exportOrders() {
    const { data } = await supabase.from('order_items')
      .select('quantity,estimated_price,products(name,category,preferred_supplier),orders!inner(status,created_at)')
      .eq('orders.status', 'received')
      .order('orders(created_at)', { ascending: false })
    if (!data) return
    const headers = ['Produkt', 'Kategorie', 'Lieferant', 'Menge', 'Preis', 'Gesamt', 'Bestelldatum']
    const rows = (data as any[]).map(oi => [
      oi.products?.name ?? '', oi.products?.category ?? '', oi.products?.preferred_supplier ?? '',
      String(oi.quantity), oi.estimated_price != null ? String(oi.estimated_price) : '',
      oi.estimated_price != null ? String(oi.estimated_price * oi.quantity) : '',
      oi.orders?.created_at ? new Date(oi.orders.created_at).toLocaleDateString('de-DE') : '',
    ])
    downloadCSV(`bestellungen_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows])
  }

  async function exportMovements() {
    const since = new Date(); since.setFullYear(since.getFullYear() - 1)
    const { data } = await supabase.from('stock_movements')
      .select('type,quantity,created_at,products(name,category)')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
    if (!data) return
    const headers = ['Produkt', 'Kategorie', 'Typ', 'Menge', 'Datum']
    const typeLabel: Record<string, string> = { scan_in: 'Eingang (Scan)', scan_out: 'Ausgang (Scan)', manual_in: 'Eingang (Manuell)', manual_out: 'Ausgang (Manuell)' }
    const rows = (data as any[]).map(m => [
      m.products?.name ?? '', m.products?.category ?? '',
      typeLabel[m.type] ?? m.type, String(m.quantity),
      new Date(m.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    ])
    downloadCSV(`lagerbewegungen_${new Date().toISOString().slice(0,10)}.csv`, [headers, ...rows])
  }

  function downloadTemplate() {
    const headers = ['name', 'barcode', 'category', 'min_stock', 'unit', 'preferred_supplier', 'last_price', 'notes']
    const example = ['Handschuhe Nitril M', '4012345678901', 'Hygiene', '5', 'Packung', 'Pluradent', '8.50', 'Latex-frei']
    downloadCSV('produkte_vorlage.csv', [headers, example])
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length === 0) { showToast('Keine Daten in der Datei gefunden.', 'error'); return }

      let created = 0; let updated = 0; let errors = 0
      for (const row of rows) {
        if (!row.name?.trim()) continue
        const product: Record<string, unknown> = {
          name: row.name.trim(),
          category: row.category?.trim() || 'General',
          min_stock: parseFloat(row.min_stock) || 1,
          unit: row.unit?.trim() || 'Stück',
        }
        if (row.barcode?.trim()) product.barcode = row.barcode.trim()
        if (row.preferred_supplier?.trim()) product.preferred_supplier = row.preferred_supplier.trim()
        if (row.last_price?.trim()) product.last_price = parseFloat(row.last_price)
        if (row.notes?.trim()) product.notes = row.notes.trim()

        // Try to match on barcode first, then name
        let existing = null
        if (product.barcode) {
          const { data } = await supabase.from('products').select('id').eq('barcode', product.barcode as string).maybeSingle()
          existing = data
        }
        if (!existing) {
          const { data } = await supabase.from('products').select('id').eq('name', product.name as string).maybeSingle()
          existing = data
        }

        if (existing) {
          const { error } = await supabase.from('products').update(product).eq('id', existing.id)
          if (error) { errors++ } else { updated++ }
        } else {
          const { error } = await supabase.from('products').insert({ ...product, current_stock: 0 })
          if (error) { errors++ } else { created++ }
        }
      }
      showToast(`Import abgeschlossen: ${created} neu, ${updated} aktualisiert${errors > 0 ? `, ${errors} Fehler` : ''}.`)
    } catch {
      showToast('Fehler beim Lesen der Datei.', 'error')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const exportButtons = [
    { label: 'Produkte exportieren', sub: 'Alle Artikel mit Bestand und Preisen', icon: <FileText size={18} className="text-sky-500" />, onClick: exportProducts },
    { label: 'Bestellungen exportieren', sub: 'Alle erhaltenen Bestellungen', icon: <FileText size={18} className="text-violet-500" />, onClick: exportOrders },
    { label: 'Lagerbewegungen exportieren', sub: 'Ein- und Ausgänge der letzten 12 Monate', icon: <FileText size={18} className="text-emerald-500" />, onClick: exportMovements },
  ]

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="max-w-xl mx-auto p-4 lg:p-6 space-y-6">

        {/* Export */}
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Exportieren</h2>
          <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
            {exportButtons.map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">{btn.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{btn.label}</p>
                  <p className="text-xs text-slate-400">{btn.sub}</p>
                </div>
                <Download size={16} className="text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Import */}
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Importieren</h2>
          <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
            <button onClick={downloadTemplate}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                <FileText size={18} className="text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">CSV-Vorlage herunterladen</p>
                <p className="text-xs text-slate-400">Vorlage für den Produkt-Import</p>
              </div>
              <Download size={16} className="text-slate-400 shrink-0" />
            </button>

            <label className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                <Upload size={18} className="text-sky-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">Produkte importieren</p>
                <p className="text-xs text-slate-400">CSV-Datei hochladen (neue Produkte anlegen oder aktualisieren)</p>
              </div>
              {importing
                ? <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin shrink-0" />
                : <Upload size={16} className="text-slate-400 shrink-0" />
              }
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} disabled={importing} />
            </label>
          </div>
        </div>

      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 md:bottom-6 left-4 right-4 z-50 flex justify-center pointer-events-none">
          <div className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl text-sm font-medium text-white ${toast.type === 'error' ? 'bg-red-500' : 'bg-slate-800'}`}>
            {toast.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} className="text-emerald-400" />}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  )
}
