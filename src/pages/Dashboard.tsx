import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, getUserRole } from '../lib/supabase'
import { subscribeToPush, currentPermission, isPushSupported } from '../lib/push'
import type { Role } from '../lib/types'
import {
  Package, ScanLine, ShoppingCart, Menu, X, Settings,
  LayoutDashboard, Bell, BellOff, ScrollText, LogOut,
  ChevronLeft, ChevronRight, PackageMinus, PackagePlus, Check,
} from 'lucide-react'

const StockPage          = lazy(() => import('./StockPage'))
const OrdersPage         = lazy(() => import('./OrdersPage'))
const OverviewPage       = lazy(() => import('./OverviewPage'))
const TermsPage          = lazy(() => import('./TermsPage'))
const EntnehmenScanModal = lazy(() => import('../components/EntnehmenScanModal'))

function PageSpinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}


type Tab = 'overview' | 'stock' | 'orders' | 'scan'

interface Props { user: User }

const PAGE_TITLES: Record<Tab, string> = {
  overview: 'Dashboard',
  stock: 'Artikel',
  scan: 'Scannen',
  orders: 'Bestellungen',
}

export default function Dashboard({ user }: Props) {
  const [role, setRole] = useState<Role | null>(null)
  const [tab, setTab] = useState<Tab>('stock')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuClosing, setMenuClosing] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const [dashToast, setDashToast] = useState<string | null>(null)
  const dashToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showDashToast(msg: string) {
    if (dashToastTimer.current) clearTimeout(dashToastTimer.current)
    setDashToast(msg)
    dashToastTimer.current = setTimeout(() => setDashToast(null), 5000)
  }


  function navigate(t: Tab) {
    setTab(t)
    closeMenu()
  }

  async function enableNotifications() {
    const result = await subscribeToPush(user.id)
    setPushPermission(result === 'granted' ? 'granted' : 'denied')
  }

  useEffect(() => {
    getUserRole().then(setRole)
  }, [])

  useEffect(() => {
    async function fetchBadge() {
      const [{ count: cartCount }, { count: pendingCount }] = await Promise.all([
        supabase.from('cart_items').select('*', { count: 'exact', head: true }),
        supabase.from('orders').select('*', { count: 'exact', head: true }).in('status', ['pending_approval', 'ordered']),
      ])
      setOrderBadge((cartCount ?? 0) + (pendingCount ?? 0))
    }
    fetchBadge()
    const interval = setInterval(fetchBadge, 60000)
    return () => clearInterval(interval)
  }, [])

  const bottomTabs: { id: Tab; icon: React.ReactNode; badge?: number }[] = [
    { id: 'stock',  icon: <Package size={26} /> },
    { id: 'orders', icon: <ShoppingCart size={26} />, badge: orderBadge },
  ]
  const activeIndex = bottomTabs.findIndex(t => t.id === tab)

  const sidebarItems: { id: Tab; icon: React.ReactNode; label: string; badge?: number }[] = [
    { id: 'stock',    icon: <Package size={20} />,         label: 'Artikel' },
    { id: 'orders',   icon: <ShoppingCart size={20} />,    label: 'Bestellungen', badge: orderBadge },
    { id: 'overview', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
  ]

  return (
    <div className="fixed top-0 left-0 right-0 h-[100dvh] overflow-hidden bg-slate-50 flex flex-col md:flex-row">

      {/* ── Sidebar (md+) ─────────────────────────────────────── */}
      <aside
        className={`hidden md:flex flex-col bg-white border-r border-slate-200 shrink-0 transition-all duration-300 ${
          sidebarCollapsed ? 'w-16' : 'w-56'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Logo + collapse toggle */}
        <div className={`flex items-center border-b border-slate-100 px-3 py-4 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!sidebarCollapsed && (
            <span className="font-bold text-slate-800 tracking-tight text-base">DentalOrder</span>
          )}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Nav — sliding panels */}
        <div className="flex-1 overflow-hidden relative">
          <div
            className="flex h-full transition-transform duration-220 ease-in-out"
            style={{ width: '200%', transform: settingsOpen && !sidebarCollapsed ? 'translateX(-50%)' : 'translateX(0)' }}
          >
            {/* ── Main panel ── */}
            <div className="overflow-y-auto py-2 space-y-0.5 px-2" style={{ width: '50%' }}>
              {sidebarItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors rounded-xl ${
                    tab === item.id ? 'bg-sky-50 text-sky-600' : 'text-slate-600 hover:bg-slate-50'
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

              {/* Settings entry */}
              <button
                onClick={() => !sidebarCollapsed && setSettingsOpen(true)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-colors text-slate-600 hover:bg-slate-50 ${sidebarCollapsed ? 'justify-center' : ''}`}
              >
                <Settings size={20} className="shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate font-medium">Einstellungen</span>
                    <ChevronRight size={14} className="ml-auto shrink-0 text-slate-400" />
                  </>
                )}
              </button>

              {/* Collapsed: show bell icon directly */}
              {sidebarCollapsed && isPushSupported() && pushPermission !== 'granted' && (
                <button
                  onClick={enableNotifications}
                  className="w-full flex items-center justify-center px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <Bell size={20} className="shrink-0" />
                </button>
              )}
              {sidebarCollapsed && pushPermission === 'granted' && (
                <div className="w-full flex items-center justify-center px-3 py-2.5 text-sm text-emerald-600 bg-emerald-50 rounded-xl">
                  <BellOff size={20} className="shrink-0" />
                </div>
              )}
            </div>

            {/* ── Settings panel ── */}
            <div className="overflow-y-auto py-2 px-2 space-y-0.5" style={{ width: '50%' }}>
              {/* Back button */}
              <button
                onClick={() => setSettingsOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 rounded-xl transition-colors mb-1"
              >
                <ChevronLeft size={16} className="shrink-0" />
                <span className="font-medium">Einstellungen</span>
              </button>
              <div className="border-t border-slate-100 pt-1">
                {isPushSupported() && pushPermission !== 'granted' && (
                  <button
                    onClick={enableNotifications}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                  >
                    <Bell size={18} className="shrink-0" />
                    <span className="truncate font-medium">Benachrichtigungen</span>
                  </button>
                )}
                {pushPermission === 'granted' && (
                  <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-emerald-600 bg-emerald-50 rounded-xl">
                    <BellOff size={18} className="shrink-0" />
                    <span className="truncate font-medium">Benachrichtigungen aktiv</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom section */}
        <div className="border-t border-slate-100 py-2 px-2 space-y-0.5">
          <div className={`${sidebarCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
            {sidebarCollapsed ? (
              <>
                <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-semibold text-sm" title={user.email ?? ''}>
                  {user.email?.[0].toUpperCase()}
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
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
                    <p className="text-xs font-medium text-slate-800 truncate">{user.email}</p>
                    <p className="text-xs text-slate-400 capitalize">{role ?? '…'}</p>
                  </div>
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors"
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
          className="bg-white border-b border-slate-200 sticky top-0 z-10"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 tracking-tight text-lg md:hidden">DentalOrder</span>
              <span className="hidden md:block font-bold text-slate-800 tracking-tight">{PAGE_TITLES[tab]}</span>
              {role === 'admin' && (
                <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium md:hidden">Admin</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setScanMode('choice')}
                className="hidden md:flex items-center justify-center p-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl transition-colors"
                title="Scannen"
              >
                <ScanLine size={20} />
              </button>
              <button
                onClick={() => setMenuOpen(true)}
                className="text-slate-500 hover:text-slate-800 p-1 transition-colors md:hidden"
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
          <div className="pb-20 md:pb-0 min-h-full">
            <Suspense fallback={<PageSpinner />}>
              {showTerms
                ? <TermsPage onBack={() => setShowTerms(false)} />
                : <>
                    {tab === 'overview' && <OverviewPage />}
                    {tab === 'stock'    && <StockPage role={role} initialBarcode={pendingBarcode} onBarcodeConsumed={() => setPendingBarcode(null)} onNavigateToOrders={() => setTab('orders')} />}
                    {tab === 'orders'   && <OrdersPage role={role} user={user} onBadgeChange={setOrderBadge} forceOpenTab={forceOrdersOpenTab} forceScanMode={forceOrdersScanMode} />}
                  </>
              }
            </Suspense>
          </div>
        </main>

        {/* Bottom nav (mobile only) */}
        <nav
          className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 md:hidden"
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
                  tab === t.id ? 'text-sky-600' : 'text-slate-400'
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-6 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setScanMode(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
              <X size={20} />
            </button>
            <h3 className="font-semibold text-slate-800 text-base mb-1">Scannen</h3>
            <p className="text-sm text-slate-400 mb-5">Was möchten Sie tun?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setScanMode('entnehmen')}
                className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 hover:border-sky-400 hover:bg-sky-50 transition-colors"
              >
                <PackageMinus size={22} className="text-sky-600" />
                <span className="text-sm font-semibold text-slate-700">Entnehmen</span>
              </button>
              <button
                onClick={() => {
                  setScanMode(null)
                  setTab('orders')
                  setForceOrdersOpenTab(c => c + 1)
                  setForceOrdersScanMode(c => c + 1)
                }}
                className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
              >
                <PackagePlus size={22} className="text-emerald-600" />
                <span className="text-sm font-semibold text-slate-700">Einbuchen</span>
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
          <div className="fixed inset-0 bg-black/30 z-40 animate-fade-in md:hidden" onClick={closeMenu} />
          <div
            ref={menuRef}
            className={`fixed top-0 right-0 h-full w-72 bg-white shadow-2xl z-50 flex flex-col overscroll-contain md:hidden ${menuClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
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
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              {settingsOpen ? (
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors"
                >
                  <ChevronLeft size={18} />
                  <span className="font-semibold text-slate-800">Einstellungen</span>
                </button>
              ) : (
                <span className="font-semibold text-slate-800">Menü</span>
              )}
              <button onClick={closeMenu} className="text-slate-400 hover:text-slate-600">
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
                  <MenuItem icon={<Package size={18} />} label="Artikel"
                    active={tab === 'stock'} onClick={() => navigate('stock')} />
                  <MenuItem icon={<ShoppingCart size={18} />} label="Bestellungen"
                    active={tab === 'orders'} onClick={() => navigate('orders')} />
                  <MenuItem icon={<LayoutDashboard size={18} />} label="Dashboard"
                    active={tab === 'overview'} onClick={() => navigate('overview')} />
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
                  {isPushSupported() && pushPermission !== 'granted' && (
                    <MenuItem
                      icon={<Bell size={18} />}
                      label="Benachrichtigungen"
                      onClick={enableNotifications}
                    />
                  )}
                  {pushPermission === 'granted' && (
                    <MenuItem
                      icon={<BellOff size={18} className="text-emerald-500" />}
                      label="Benachrichtigungen aktiv"
                      onClick={() => {}}
                      active
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 p-4 shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-semibold text-sm">
                  {user.email?.[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{user.email}</p>
                  <p className="text-xs text-slate-400 capitalize">{role ?? '…'}</p>
                </div>
              </div>
              <button onClick={() => supabase.auth.signOut()}
                className="w-full flex items-center gap-2 px-2 py-2.5 text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors">
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
      className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left ${
        active ? 'text-sky-600 bg-sky-50' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight size={14} className="text-slate-400" />}
    </button>
  )
}
