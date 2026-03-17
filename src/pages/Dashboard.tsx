import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, getUserRole } from '../lib/supabase'
import type { Role } from '../lib/types'
import StockPage from './StockPage'
import OrdersPage from './OrdersPage'
import ScanPage from './ScanPage'
import { Package, ScanLine, ShoppingCart, Menu, X, Settings } from 'lucide-react'

type Tab = 'stock' | 'scan' | 'orders'

interface Props { user: User }

export default function Dashboard({ user }: Props) {
  const [role, setRole] = useState<Role | null>(null)
  const [tab, setTab] = useState<Tab>('stock')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null)

  function handleAddWithBarcode(barcode: string) {
    setPendingBarcode(barcode)
    setTab('stock')
  }

  useEffect(() => {
    getUserRole().then(setRole)
  }, [])

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'stock',  label: 'Lager',        icon: <Package size={20} /> },
    { id: 'scan',   label: 'Scannen',      icon: <ScanLine size={20} /> },
    { id: 'orders', label: 'Bestellungen', icon: <ShoppingCart size={20} /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-xl">🦷</span>
          <span className="font-semibold text-slate-800">Dental Order</span>
          {role === 'admin' && (
            <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">Admin</span>
          )}
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          className="text-slate-500 hover:text-slate-800 p-1 transition-colors"
          title="Menü"
        >
          <Menu size={22} />
        </button>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-auto pb-20">
        <>
          {tab === 'stock'  && <StockPage role={role} initialBarcode={pendingBarcode} onBarcodeConsumed={() => setPendingBarcode(null)} />}
          {tab === 'scan'   && <ScanPage onAddWithBarcode={handleAddWithBarcode} />}
          {tab === 'orders' && <OrdersPage role={role} user={user} />}
        </>
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 text-xs transition-colors ${
              tab === t.id ? 'text-sky-600' : 'text-slate-500'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {/* Hamburger drawer */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setMenuOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-72 bg-white shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <span className="font-semibold text-slate-800">Menü</span>
              <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 py-2">
              <MenuItem icon={<Settings size={18} />} label="Einstellungen" onClick={() => setMenuOpen(false)} disabled />
            </nav>

            <div className="border-t border-slate-100 p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-semibold text-sm">
                  {user.email?.[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{user.email}</p>
                  <p className="text-xs text-slate-400 capitalize">{role ?? '…'}</p>
                </div>
              </div>
              <button
                onClick={() => supabase.auth.signOut()}
                className="w-full text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-xl py-2.5 transition-colors"
              >
                Abmelden
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, disabled = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left ${
        disabled ? 'text-slate-300' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
      {disabled && <span className="ml-auto text-xs text-slate-300">Bald</span>}
    </button>
  )
}
