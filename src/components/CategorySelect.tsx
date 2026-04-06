import { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  categories: string[]
  required?: boolean
  placeholder?: string
  newLabel?: string
  emptyLabel?: string
  allowNew?: boolean
}

export default function CategorySelect({ value, onChange, categories, required, placeholder = 'Kategorie suchen…', newLabel = 'als neue Kategorie', emptyLabel = 'Keine Einträge vorhanden', allowNew = true }: Props) {
  const [search, setSearch] = useState(value)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setSearch(value) }, [value])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSearch(value) // restore on outside click
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [value])

  const filtered = categories.filter(c =>
    c.toLowerCase().includes(search.toLowerCase())
  )
  const exactMatch = categories.some(c => c.toLowerCase() === search.trim().toLowerCase())

  function select(cat: string) {
    onChange(cat)
    setSearch(cat)
    setOpen(false)
  }

  function handleFocus() {
    setSearch('') // clear so all options are visible
    setOpen(true)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={handleFocus}
          required={required}
          placeholder={placeholder}
          className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
        />
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>

      {open && (
        <div className="absolute z-20 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg mt-1 max-h-52 overflow-y-auto">
          {filtered.length === 0 && !search.trim() && (
            <p className="text-xs text-slate-400 px-3 py-2">{emptyLabel}</p>
          )}
          {filtered.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => select(cat)}
              className={`w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                cat === value ? 'text-sky-600 font-medium' : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
          {allowNew && !exactMatch && search.trim() && (
            <button
              type="button"
              onClick={() => select(search.trim())}
              className="w-full text-left px-3 py-2.5 text-sm text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors flex items-center gap-2 border-t border-slate-100 dark:border-slate-700"
            >
              <Plus size={14} />
              "{search.trim()}" {newLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
