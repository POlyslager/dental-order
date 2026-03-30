import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, getUserRole } from '../lib/supabase'
import { subscribeToPush, unsubscribeFromPush, currentPermission, isPushSupported } from '../lib/push'
import type { Role } from '../lib/types'
import {
  Package, ScanLine, ShoppingCart, Menu, X, Settings,
  LayoutDashboard, Bell, BellOff, ScrollText, LogOut,
  ChevronLeft, ChevronRight, PackageMinus, PackagePlus, Check,
  Users, Tag, KeyRound, Database, Factory, Sun, Moon,
} from 'lucide-react'
import { applyTheme, getStoredTheme } from '../lib/theme'
const StockPage          = lazy(() => import('./StockPage'))
const OrdersPage         = lazy(() => import('./OrdersPage'))
const OverviewPage       = lazy(() => import('./OverviewPage'))
const TermsPage          = lazy(() => import('./TermsPage'))
const EntnehmenScanModal = lazy(() => import('../components/EntnehmenScanModal'))
const SuppliersPage      = lazy(() => import('./SuppliersPage'))
const BrandsPage         = lazy(() => import('./BrandsPage'))
const CategoriesPage     = lazy(() => import('./CategoriesPage'))
const DataPage           = lazy(() => import('./DataPage'))
const PinSettingsPage    = lazy(() => import('../components/PinSettingsModal'))

function PageSpinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}


type Tab = 'overview' | 'stock' | 'orders' | 'scan' | 'suppliers' | 'brands' | 'categories' | 'data' | 'pin'

interface Props { user: User }

const PAGE_TITLES: Record<Tab, string> = {
  overview: 'Dashboard',
  stock: 'Artikel',
  scan: 'Scannen',
  orders: 'Bestellungen',
  suppliers: 'Lieferanten',
  brands: 'Hersteller',
  categories: 'Kategorien',
  data: 'Daten & Import',
  pin: 'PIN-Verwaltung',
}

export default function Dashboard({ user }: Props) {
  const [role, setRole] = useState<Role | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = getStoredTheme()
    if (stored === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    return stored as 'light' | 'dark'
  })

  function toggleTheme() {
    const next: 'light' | 'dark' = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
  }
  const [tab, setTab] = useState<Tab>('stock')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuClosing, setMenuClosing] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const swipeTouchX = useRef<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 500)
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < 480)
  const swipeStartX = useRef<number | null>(null)
  const swipeDeltaX = useRef(0)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const isDragging = useRef(false)

  function closeMenu() {
    setMenuClosing(true)
    setTimeout(() => {
      setMenuOpen(false)
      setMenuClosing(false)
      setSettingsOpen(false)
    }, 260)
  }

  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null)
  const [orderBadge, setOrderBadge] = useState(0)
  const [pushPermission, setPushPermission] = useState(() => currentPermission())
  const [scanMode, setScanMode] = useState<null | 'choice' | 'entnehmen'>(null)
  const [forceOrdersOpenTab, setForceOrdersOpenTab] = useState(0)
  const [forceOrdersScanMode, setForceOrdersScanMode] = useState(0)
  const [phoneTab, setPhoneTab] = useState<'stock' | 'cart' | 'approval'>('stock')
  const [pendingBadge, setPendingBadge] = useState(0)
  const [forceCartTab, setForceCartTab] = useState(0)
  const [forceApprovalTab, setForceApprovalTab] = useState(0)
  const [dashToast, setDashToast] = useState<string | null>(null)
  const dashToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false)
  const [phoneMenuClosing, setPhoneMenuClosing] = useState(false)
  const [phonePinOpen, setPhonePinOpen] = useState(false)
  const phoneMenuSwipeX = useRef<number | null>(null)

  function closePhoneMenu() {
    setPhoneMenuClosing(true)
    setTimeout(() => { setPhoneMenuOpen(false); setPhoneMenuClosing(false) }, 260)
  }
  function showDashToast(msg: string) {
    if (dashToastTimer.current) clearTimeout(dashToastTimer.current)
    setDashToast(msg)
    dashToastTimer.current = setTimeout(() => setDashToast(null), 5000)
  }


  function navigate(t: Tab) {
    setTab(t)
    closeMenu()
  }

  async function toggleNotifications() {
    if (pushPermission === 'granted') {
      await unsubscribeFromPush(user.id)
      setPushPermission('default')
    } else {
      const result = await subscribeToPush(user.id)
      setPushPermission(result === 'granted' ? 'granted' : 'denied')
    }
  }

  useEffect(() => {
    getUserRole().then(setRole)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const intent = params.get('intent')
    if (intent === 'approval') {
      setPhoneTab('approval')
      setForceApprovalTab(c => c + 1)
      window.history.replaceState({}, '', '/')
    } else if (intent === 'cart') {
      setPhoneTab('cart')
      setForceCartTab(c => c + 1)
      window.history.replaceState({}, '', '/')
    }
  }, [])

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return
    const bc = new BroadcastChannel('dentalorder-nav')
    bc.onmessage = (e) => {
      if (e.data?.type === 'navigate') {
        if (e.data.intent === 'approval') {
          setPhoneTab('approval')
          setForceApprovalTab(c => c + 1)
        } else if (e.data.intent === 'cart') {
          setPhoneTab('cart')
          setForceCartTab(c => c + 1)
        }
      }
    }
    return () => bc.close()
  }, [])

  useEffect(() => {
    function check() {
      setIsDesktop(window.innerWidth >= 500)
      setIsPhone(window.innerWidth < 480)
    }
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  async function fetchBadge() {
    const [{ count: cartCount }, { data: ordersData }, { count: pendingCount }] = await Promise.all([
      supabase.from('cart_items').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('id, supplier, items:order_items(id)').eq('status', 'ordered'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    ])
    const ordersWithItems = (ordersData ?? []).filter((o: { supplier?: string; items?: { id: string }[] }) => (o.items?.length ?? 0) > 0)
    const uniqueSuppliers = new Set(ordersWithItems.map(o => o.supplier ?? 'Unbekannter Lieferant')).size
    setOrderBadge((cartCount ?? 0) + uniqueSuppliers)
    setPendingBadge(pendingCount ?? 0)
  }

  useEffect(() => {
    fetchBadge()
    const channel = supabase
      .channel('badge-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cart_items' }, fetchBadge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchBadge)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const SETTINGS_TABS = new Set<Tab>(['pin'])
  const showSettingsPanel = !sidebarCollapsed && (settingsOpen || SETTINGS_TABS.has(tab))

  const bottomTabs: { id: Tab; icon: React.ReactNode; badge?: number }[] = [
    { id: 'stock',  icon: <Package size={26} /> },
    { id: 'orders', icon: <ShoppingCart size={26} />, badge: orderBadge },
  ]
  const activeIndex = bottomTabs.findIndex(t => t.id === tab)

  const sidebarItems: { id: Tab; icon: React.ReactNode; label: string; badge?: number }[] = [
    ...(role === 'admin' ? [{ id: 'overview' as Tab, icon: <LayoutDashboard size={20} />, label: 'Dashboard' }] : []),
    { id: 'orders',     icon: <ShoppingCart size={20} />,  label: 'Bestellungen', badge: orderBadge },
    { id: 'stock',      icon: <Package size={20} />,       label: 'Artikel' },
    { id: 'suppliers',  icon: <Users size={20} />,         label: 'Lieferanten' },
    { id: 'brands',     icon: <Factory size={20} />,       label: 'Hersteller' },
    { id: 'categories', icon: <Tag size={20} />,           label: 'Kategorien' },
  ]

  // ── Phone shell (< 480px) ────────────────────────────────────────────────
  if (isPhone) {
    return (
      <div className="fixed inset-0 flex flex-col bg-slate-50 dark:bg-slate-900" style={{ height: '100dvh' }}>
        {/* Header */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="font-bold text-slate-800 dark:text-slate-100 tracking-tight text-lg">DentalOrder</span>
            <button onClick={() => setPhoneMenuOpen(true)} className="p-1.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <Menu size={22} />
            </button>
          </div>
        </header>

        {/* Content — stock and orders kept mounted to preserve state */}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className={`flex-1 min-h-0 flex flex-col ${phoneTab === 'stock' ? '' : 'hidden'}`}>
            <Suspense fallback={<PageSpinner />}>
              <StockPage role={role} initialBarcode={pendingBarcode} onBarcodeConsumed={() => setPendingBarcode(null)} onNavigateToOrders={() => { setPhoneTab('cart'); setForceCartTab(c => c + 1) }} />
            </Suspense>
          </div>
          <div className={`flex-1 flex flex-col overflow-hidden ${phoneTab !== 'stock' ? '' : 'hidden'}`}>
            <Suspense fallback={<PageSpinner />}>
              <OrdersPage role={role} user={user} onBadgeChange={setOrderBadge} onPendingChange={setPendingBadge} forceOpenTab={forceOrdersOpenTab} forceScanMode={forceOrdersScanMode} forceCartTab={forceCartTab} forceApprovalTab={forceApprovalTab} />
            </Suspense>
          </div>
        </main>

        {/* Bottom nav */}
        <nav className="bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex">
            <button onClick={() => setPhoneTab('stock')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors ${phoneTab === 'stock' ? 'text-sky-600' : 'text-slate-400 dark:text-slate-500'}`}>
              <Package size={22} />
              <span className="text-[10px] font-medium">Bestand</span>
            </button>
            <button onClick={() => setScanMode('choice')}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-3 text-slate-400 dark:text-slate-500 transition-colors">
              <ScanLine size={22} />
              <span className="text-[10px] font-medium">Scan</span>
            </button>
            <button onClick={() => { setPhoneTab('cart'); setForceCartTab(c => c + 1) }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors ${phoneTab === 'cart' ? 'text-sky-600' : 'text-slate-400 dark:text-slate-500'}`}>
              <div className="relative">
                <ShoppingCart size={22} />
                {orderBadge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                    {orderBadge > 9 ? '9+' : orderBadge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">Warenkorb</span>
            </button>
            {role === 'admin' && (
              <button onClick={() => { setPhoneTab('approval'); setForceApprovalTab(c => c + 1) }}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors ${phoneTab === 'approval' ? 'text-sky-600' : 'text-slate-400 dark:text-slate-500'}`}>
                <div className="relative">
                  <Check size={22} />
                  {pendingBadge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                      {pendingBadge > 9 ? '9+' : pendingBadge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">Freigabe</span>
              </button>
            )}
          </div>
        </nav>

        {/* Scan modals */}
        {scanMode === 'choice' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setScanMode(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-xs p-6 relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => setScanMode(null)} className="absolute top-4 right-4 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={20} />
              </button>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">Scannen</h3>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-5">Was möchten Sie tun?</p>
              <div className="flex gap-3">
                <button onClick={() => setScanMode('entnehmen')} className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors">
                  <PackageMinus size={22} className="text-sky-600" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Entnehmen</span>
                </button>
                <button onClick={() => { setScanMode(null); setPhoneTab('cart'); setForceOrdersScanMode(c => c + 1) }} className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors">
                  <PackagePlus size={22} className="text-emerald-600" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Einbuchen</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {scanMode === 'entnehmen' && (
          <Suspense fallback={null}>
            <EntnehmenScanModal onClose={() => setScanMode(null)} onSuccess={(name) => { setScanMode(null); showDashToast(`${name} wurde entnommen`) }} />
          </Suspense>
        )}
        {dashToast && (
          <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none">
            <div className="pointer-events-auto bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-4 flex items-center gap-3 max-w-[calc(100vw-2rem)]">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Check size={16} className="text-emerald-400" />
              </div>
              <p className="text-sm font-medium">{dashToast}</p>
              <button onClick={() => setDashToast(null)} className="text-white/50 hover:text-white transition-colors shrink-0 ml-1"><X size={16} /></button>
            </div>
          </div>
        )}

        {/* Phone PIN overlay */}
        {phonePinOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-900" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <button onClick={() => setPhonePinOpen(false)} className="p-1.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <ChevronLeft size={22} />
              </button>
              <span className="font-semibold text-slate-800 dark:text-slate-100">PIN-Verwaltung</span>
            </div>
            <Suspense fallback={<PageSpinner />}>
              <PinSettingsPage onClose={() => setPhonePinOpen(false)} />
            </Suspense>
          </div>
        )}

        {/* Phone hamburger menu */}
        {phoneMenuOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" onClick={closePhoneMenu}>
            <div className={`absolute inset-0 bg-black/40 ${phoneMenuClosing ? 'animate-fade-out' : 'animate-fade-in'}`} />
            <div
              className={`relative w-72 h-full bg-white dark:bg-slate-800 shadow-2xl flex flex-col ${phoneMenuClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
              style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
              onClick={e => e.stopPropagation()}
              onTouchStart={e => { phoneMenuSwipeX.current = e.touches[0].clientX }}
              onTouchEnd={e => {
                if (phoneMenuSwipeX.current === null) return
                const dx = e.changedTouches[0].clientX - phoneMenuSwipeX.current
                phoneMenuSwipeX.current = null
                if (dx > 50) closePhoneMenu()
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 dark:border-slate-700">
                <span className="font-semibold text-slate-800 dark:text-slate-100">Einstellungen</span>
                <button onClick={closePhoneMenu} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                {/* Theme */}
                <button onClick={() => { toggleTheme() }} className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  {theme === 'dark' ? <Moon size={20} className="text-slate-500 dark:text-slate-400 shrink-0" /> : <Sun size={20} className="text-slate-500 dark:text-slate-400 shrink-0" />}
                  <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 text-left">Erscheinungsbild</span>
                  <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-0.5 shrink-0 pointer-events-none">
                    <span className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}><Sun size={12} /></span>
                    <span className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'bg-slate-600 shadow text-indigo-300' : 'text-slate-400 dark:text-slate-400'}`}><Moon size={12} /></span>
                  </div>
                </button>
                {/* Push notifications */}
                {isPushSupported() && (
                  <button onClick={async () => { await toggleNotifications() }} className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <Bell size={20} className="text-slate-500 dark:text-slate-400 shrink-0" />
                    <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 text-left">Benachrichtigungen</span>
                    <div className="flex items-center bg-slate-200 dark:bg-slate-600 rounded-full p-0.5 shrink-0 pointer-events-none">
                      <span className={`p-1.5 rounded-full transition-all ${pushPermission !== 'granted' ? 'bg-white dark:bg-slate-500 shadow text-slate-500 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}><BellOff size={14} /></span>
                      <span className={`p-1.5 rounded-full transition-all ${pushPermission === 'granted' ? 'bg-sky-500 shadow text-white' : 'text-slate-400 dark:text-slate-400'}`}><Bell size={14} /></span>
                    </div>
                  </button>
                )}
                {/* PIN Verwaltung (admin only) */}
                {role === 'admin' && (
                  <button onClick={() => { closePhoneMenu(); setTimeout(() => setPhonePinOpen(true), 260) }} className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <KeyRound size={20} className="text-slate-500 dark:text-slate-400 shrink-0" />
                    <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 text-left">PIN-Verwaltung</span>
                  </button>
                )}
                {/* Logout */}
                <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <LogOut size={20} className="text-red-500 shrink-0" />
                  <span className="flex-1 text-sm font-medium text-red-600 dark:text-red-400 text-left">Abmelden</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`fixed top-0 left-0 right-0 h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-900 flex ${isDesktop ? 'flex-row' : 'flex-col'}`}>

      {/* ── Sidebar (md+) ─────────────────────────────────────── */}
      <aside
        className={`${isDesktop ? 'flex' : 'hidden'} flex-col bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 shrink-0 transition-all duration-300 ${
          sidebarCollapsed ? 'w-16' : 'w-56'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
        onTouchStart={e => { swipeTouchX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (swipeTouchX.current === null) return
          const dx = e.changedTouches[0].clientX - swipeTouchX.current
          swipeTouchX.current = null
          if (dx < -40) setSidebarCollapsed(true)
          else if (dx > 40) setSidebarCollapsed(false)
        }}
      >
        {/* Logo + collapse toggle */}
        <div className={`flex items-center border-b border-slate-100 dark:border-slate-700 px-3 py-4 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!sidebarCollapsed && (
            <span className="font-bold text-slate-800 dark:text-slate-100 tracking-tight text-base">DentalOrder</span>
          )}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Nav — sliding panels */}
        <div className="flex-1 overflow-hidden relative">
          <div
            className="flex h-full transition-transform duration-220 ease-in-out"
            style={{ width: '200%', transform: showSettingsPanel ? 'translateX(-50%)' : 'translateX(0)' }}
          >
            {/* ── Main panel ── */}
            <div className="overflow-y-auto py-2 space-y-0.5 px-2" style={{ width: '50%' }}>
              {sidebarItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => { setTab(item.id); setSettingsOpen(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors rounded-xl ${
                    tab === item.id ? 'bg-sky-50 text-sky-600' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                >
                  <span className="shrink-0 relative">
                    {item.icon}
                    {!!item.badge && item.badge > 0 && (
                      <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </span>
                  {!sidebarCollapsed && <span className="truncate font-medium">{item.label}</span>}
                </button>
              ))}

              {/* Settings entry — all users */}
              <button
                onClick={() => { if (sidebarCollapsed) setSidebarCollapsed(false); setSettingsOpen(true) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 ${sidebarCollapsed ? 'justify-center' : ''}`}
              >
                <Settings size={20} className="shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate font-medium">Einstellungen</span>
                    <ChevronRight size={14} className="ml-auto shrink-0 text-slate-400 dark:text-slate-500" />
                  </>
                )}
              </button>

            </div>

            {/* ── Settings panel ── */}
            <div className="overflow-y-auto py-2 px-2 space-y-0.5" style={{ width: '50%' }}>
              {/* Back button */}
              <button
                onClick={() => { setSettingsOpen(false); if (SETTINGS_TABS.has(tab)) setTab('stock') }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-colors mb-1"
              >
                <ChevronLeft size={16} className="shrink-0" />
                <span className="font-medium">Einstellungen</span>
              </button>
              <div className="border-t border-slate-100 dark:border-slate-700 pt-1 space-y-0.5">
                {([
                  { id: 'data' as Tab, icon: <Database size={18} />, label: 'Daten & Import' },
                ] as { id: Tab; icon: React.ReactNode; label: string }[]).map(item => (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors ${
                      tab === item.id ? 'bg-sky-50 text-sky-600' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="truncate font-medium">{item.label}</span>
                  </button>
                ))}
                {role === 'admin' && (
                  <button
                    onClick={() => setTab('pin')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors ${tab === 'pin' ? 'bg-sky-50 text-sky-600' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                  >
                    <span className="shrink-0"><KeyRound size={18} /></span>
                    <span className="truncate font-medium">PIN-Verwaltung</span>
                  </button>
                )}
                <button
                  onClick={toggleTheme}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  {theme === 'dark' ? <Moon size={18} className="shrink-0 text-slate-400 dark:text-slate-500" /> : <Sun size={18} className="shrink-0 text-slate-400 dark:text-slate-500" />}
                  <span className="flex-1 truncate font-medium">Erscheinungsbild</span>
                  <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-0.5 shrink-0 pointer-events-none">
                    <span className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>
                      <Sun size={12} />
                    </span>
                    <span className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'bg-slate-600 shadow text-indigo-300' : 'text-slate-400 dark:text-slate-400'}`}>
                      <Moon size={12} />
                    </span>
                  </div>
                </button>
                {isPushSupported() && (
                  <button
                    onClick={toggleNotifications}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-colors"
                  >
                    <Bell size={18} className="shrink-0" />
                    <span className="flex-1 truncate font-medium">Benachrichtigungen</span>
                    <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-0.5 shrink-0 pointer-events-none">
                      <span className={`p-1.5 rounded-full transition-all ${pushPermission !== 'granted' ? 'bg-white dark:bg-slate-600 shadow text-slate-500 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                        <BellOff size={12} />
                      </span>
                      <span className={`p-1.5 rounded-full transition-all ${pushPermission === 'granted' ? 'bg-sky-500 dark:bg-slate-600 shadow text-white dark:text-sky-300' : 'text-slate-400 dark:text-slate-400'}`}>
                        <Bell size={12} />
                      </span>
                    </div>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom section */}
        <div className="border-t border-slate-100 dark:border-slate-700 py-2 px-2 space-y-0.5">
          <div className={`${sidebarCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
            {sidebarCollapsed ? (
              <>
                <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-semibold text-sm" title={user.email ?? ''}>
                  {user.email?.[0].toUpperCase()}
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 transition-colors"
                  title="Abmelden"
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 px-1 mb-2">
                  <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-semibold text-sm shrink-0">
                    {user.email?.[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{user.email}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 capitalize">{role ?? '…'}</p>
                  </div>
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 rounded-xl transition-colors"
                >
                  <LogOut size={18} className="shrink-0" />
                  <span className="font-medium">Abmelden</span>
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Right side: header + main ──────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header
          className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`font-bold text-slate-800 dark:text-slate-100 tracking-tight text-lg ${isDesktop ? 'hidden' : ''}`}>DentalOrder</span>
              <span className={`${isDesktop ? 'block' : 'hidden'} font-bold text-slate-800 dark:text-slate-100 tracking-tight`}>{PAGE_TITLES[tab]}</span>
              {role === 'admin' && (
                <span className={`text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium ${isDesktop ? 'hidden' : ''}`}>Admin</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setScanMode('choice')}
                className={`${isDesktop ? 'flex' : 'hidden'} items-center justify-center p-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl transition-colors`}
                title="Scannen"
              >
                <ScanLine size={20} />
              </button>
              <button
                onClick={() => setMenuOpen(true)}
                className={`text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 p-1 transition-colors ${isDesktop ? 'hidden' : ''}`}
              >
                <Menu size={22} />
              </button>
            </div>
          </div>
        </header>

        <main
          className={`flex-1 ${menuOpen ? 'overflow-hidden' : 'overflow-y-auto'}`}
          style={{ overscrollBehavior: 'none' }}
        >
          <div className={(SETTINGS_TABS.has(tab) || tab === 'orders' || tab === 'suppliers' || tab === 'brands' || tab === 'categories') ? 'h-full flex flex-col' : `${isDesktop ? 'pb-0' : 'pb-20'} min-h-full`}>
            <Suspense fallback={<PageSpinner />}>
              {showTerms
                ? <TermsPage onBack={() => setShowTerms(false)} />
                : <>
                    {tab === 'overview'    && <OverviewPage />}
                    {tab === 'stock'       && <StockPage role={role} initialBarcode={pendingBarcode} onBarcodeConsumed={() => setPendingBarcode(null)} onNavigateToOrders={() => setTab('orders')} />}
                    {tab === 'orders'      && <OrdersPage role={role} user={user} onBadgeChange={setOrderBadge} forceOpenTab={forceOrdersOpenTab} forceScanMode={forceOrdersScanMode} />}
                    {tab === 'suppliers'   && <SuppliersPage />}
                    {tab === 'brands'      && <BrandsPage />}
                    {tab === 'categories'  && <CategoriesPage />}
                    {tab === 'data'        && <DataPage />}
                    {tab === 'pin'         && <PinSettingsPage onClose={() => setTab('stock')} />}
                  </>
              }
            </Suspense>
          </div>
        </main>

        {/* Bottom nav (mobile only) */}
        <nav
          className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 ${isDesktop ? 'hidden' : ''}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="relative flex max-w-2xl mx-auto">
            {activeIndex >= 0 && (
              <div
                className="absolute w-14 h-14 rounded-full bg-sky-50 transition-all duration-300 ease-out pointer-events-none"
                style={{
                  left: `calc(${(activeIndex + 0.5) / bottomTabs.length * 100}% - 28px)`,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              />
            )}
            {bottomTabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center py-5 relative z-10 transition-colors duration-200 ${
                  tab === t.id ? 'text-sky-600' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                <div className="relative">
                  {t.icon}
                  {!!t.badge && t.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                      {t.badge > 9 ? '9+' : t.badge}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* ── Scan choice modal ── */}
      {scanMode === 'choice' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setScanMode(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-xs p-6 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setScanMode(null)} className="absolute top-4 right-4 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <X size={20} />
            </button>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">Scannen</h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-5">Was möchten Sie tun?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setScanMode('entnehmen')}
                className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"
              >
                <PackageMinus size={22} className="text-sky-600" />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Entnehmen</span>
              </button>
              <button
                onClick={() => {
                  setScanMode(null)
                  setTab('orders')
                  setForceOrdersOpenTab(c => c + 1)
                  setForceOrdersScanMode(c => c + 1)
                }}
                className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
              >
                <PackagePlus size={22} className="text-emerald-600" />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Einbuchen</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Entnehmen scan modal ── */}
      {scanMode === 'entnehmen' && (
        <Suspense fallback={null}>
          <EntnehmenScanModal
            onClose={() => setScanMode(null)}
            onSuccess={(name) => {
              setScanMode(null)
              showDashToast(`${name} wurde entnommen`)
            }}
          />
        </Suspense>
      )}

      {/* ── Dash toast ── */}
      {dashToast && (
        <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-4 flex items-center gap-3 max-w-[calc(100vw-2rem)]">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <Check size={16} className="text-emerald-400" />
            </div>
            <p className="text-sm font-medium">{dashToast}</p>
            <button onClick={() => setDashToast(null)} className="text-white/50 hover:text-white transition-colors shrink-0 ml-1">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile hamburger overlay menu ─────────────────────── */}
      {menuOpen && (
        <>
          <div className={`fixed inset-0 bg-black/30 z-40 animate-fade-in ${isDesktop ? 'hidden' : ''}`} onClick={closeMenu} />
          <div
            ref={menuRef}
            className={`fixed top-0 right-0 h-full w-72 bg-white dark:bg-slate-800 shadow-2xl z-50 flex flex-col overscroll-contain ${isDesktop ? 'hidden' : menuClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
            onTouchStart={e => {
              swipeStartX.current = e.touches[0].clientX
              swipeDeltaX.current = 0
              isDragging.current = true
            }}
            onTouchMove={e => {
              if (!isDragging.current || swipeStartX.current === null) return
              const delta = Math.max(0, e.touches[0].clientX - swipeStartX.current)
              swipeDeltaX.current = delta
              if (menuRef.current) {
                menuRef.current.style.transition = 'none'
                menuRef.current.style.transform = `translateX(${delta}px)`
              }
            }}
            onTouchEnd={() => {
              isDragging.current = false
              if (swipeDeltaX.current > 80) {
                closeMenu()
              } else if (menuRef.current) {
                menuRef.current.style.transition = 'transform 260ms cubic-bezier(0.32,0,0.2,1)'
                menuRef.current.style.transform = 'translateX(0)'
              }
              swipeStartX.current = null
            }}
          >
            {/* Header — changes when in settings panel */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
              {settingsOpen ? (
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
                >
                  <ChevronLeft size={18} />
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Einstellungen</span>
                </button>
              ) : (
                <span className="font-semibold text-slate-800 dark:text-slate-100">Menü</span>
              )}
              <button onClick={closeMenu} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                <X size={20} />
              </button>
            </div>

            {/* Nav — sliding panels */}
            <div className="flex-1 overflow-hidden relative">
              <div
                className="flex h-full transition-transform duration-220 ease-in-out"
                style={{ width: '200%', transform: settingsOpen ? 'translateX(-50%)' : 'translateX(0)' }}
              >
                {/* Main panel */}
                <div className="overflow-y-auto py-2" style={{ width: '50%' }}>
                  {role === 'admin' && (
                    <MenuItem icon={<LayoutDashboard size={18} />} label="Dashboard"
                      active={tab === 'overview'} onClick={() => navigate('overview')} />
                  )}
                  <MenuItem icon={<ShoppingCart size={18} />} label="Bestellungen"
                    active={tab === 'orders'} onClick={() => navigate('orders')} />
                  <MenuItem icon={<Package size={18} />} label="Artikel"
                    active={tab === 'stock'} onClick={() => navigate('stock')} />
                  <MenuItem icon={<Users size={18} />} label="Lieferanten"
                    active={tab === 'suppliers'} onClick={() => navigate('suppliers')} />
                  <MenuItem icon={<Factory size={18} />} label="Hersteller"
                    active={tab === 'brands'} onClick={() => navigate('brands')} />
                  <MenuItem icon={<Tag size={18} />} label="Kategorien"
                    active={tab === 'categories'} onClick={() => navigate('categories')} />
                  <MenuItem
                    icon={<Settings size={18} />}
                    label="Einstellungen"
                    onClick={() => setSettingsOpen(true)}
                    chevron
                  />
                  <MenuItem icon={<ScrollText size={18} />} label="Nutzungsbedingungen"
                    onClick={() => { setShowTerms(true); closeMenu() }} />
                </div>

                {/* Settings panel */}
                <div className="overflow-y-auto py-2" style={{ width: '50%' }}>
                  <MenuItem
                    icon={<Database size={18} />}
                    label="Daten & Import"
                    onClick={() => navigate('data')}
                  />
                  {role === 'admin' && (
                    <MenuItem
                      icon={<KeyRound size={18} />}
                      label="PIN-Verwaltung"
                      onClick={() => navigate('pin')}
                    />
                  )}
                  <button
                    onClick={toggleTheme}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 rounded-xl transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    {theme === 'dark' ? <Moon size={18} className="shrink-0 text-slate-500 dark:text-slate-400" /> : <Sun size={18} className="shrink-0 text-slate-500 dark:text-slate-400" />}
                    <span className="flex-1 font-medium text-left">Erscheinungsbild</span>
                    <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-0.5 shrink-0 pointer-events-none">
                      <span className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>
                        <Sun size={12} />
                      </span>
                      <span className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'bg-slate-600 shadow text-indigo-300' : 'text-slate-400 dark:text-slate-400'}`}>
                        <Moon size={12} />
                      </span>
                    </div>
                  </button>
                  {isPushSupported() && (
                    <button
                      onClick={toggleNotifications}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 rounded-xl transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Bell size={18} className="shrink-0 text-slate-500 dark:text-slate-400" />
                      <span className="flex-1 font-medium text-left">Benachrichtigungen</span>
                      <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${pushPermission === 'granted' ? 'bg-sky-500' : 'bg-slate-200 dark:bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${pushPermission === 'granted' ? 'left-4' : 'left-0.5'}`} />
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700 p-4 shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-semibold text-sm">
                  {user.email?.[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{user.email}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 capitalize">{role ?? '…'}</p>
                </div>
              </div>
              <button onClick={() => supabase.auth.signOut()}
                className="w-full flex items-center gap-2 px-2 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 rounded-xl transition-colors">
                <LogOut size={18} className="shrink-0" />
                <span className="font-medium">Abmelden</span>
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  )
}

function MenuItem({ icon, label, onClick, active = false, chevron = false }: {
  icon: React.ReactNode; label: string; onClick: () => void
  active?: boolean; chevron?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors text-left ${
        active ? 'text-sky-600 bg-sky-50' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight size={14} className="text-slate-400 dark:text-slate-500" />}
    </button>
  )
}
