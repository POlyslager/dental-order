import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, getUserRole } from '../lib/supabase'
import type { Role } from '../lib/types'
import StockPage from './StockPage'
import OrdersPage from './OrdersPage'
import ScanPage from './ScanPage'

type Tab = 'stock' | 'orders' | 'scan'

interface Props { user: User }

export default function Dashboard({ user }: Props) {
  const [role, setRole] = useState<Role | null>(null)
  const [tab, setTab] = useState<Tab>('stock')

  useEffect(() => {
    getUserRole().then(setRole)
  }, [])

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'stock', label: 'Stock', icon: '📦' },
    { id: 'scan', label: 'Scan', icon: '📷' },
    { id: 'orders', label: 'Orders', icon: '🛒' },
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
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          Sign out
        </button>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-auto pb-20">
        {tab === 'stock' && <StockPage role={role} />}
        {tab === 'scan' && <ScanPage />}
        {tab === 'orders' && <OrdersPage role={role} user={user} />}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex safe-area-pb">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 text-xs transition-colors ${
              tab === t.id ? 'text-sky-600' : 'text-slate-500'
            }`}
          >
            <span className="text-xl">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
