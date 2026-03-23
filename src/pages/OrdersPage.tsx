import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CartItem, Order, OrderItem, Role } from '../lib/types'
import { ShoppingCart, Package, Plus, Minus, CheckCircle, AlertCircle, ExternalLink, Check, Trash2, Undo2 } from 'lucide-react'

const APPROVAL_THRESHOLD = 2000

interface Props { role: Role | null; user: User; onBadgeChange: (n: number) => void }

// Extract domain from a URL, e.g. "https://www.dental-shop.de/..." → "dental-shop.de"
function getDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export default function OrdersPage({ role, user, onBadgeChange }: Props) {
  const [tab, setTab] = useState<'cart' | 'open'>('cart')
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [placingItem, setPlacingItem] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<CartItem | null>(null)
  const [toast, setToast] = useState<{ message: string; onUndo?: () => void } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Promise.all([fetchCart(), fetchOrders()])
  }, [])

  async function fetchCart() {
    const { data } = await supabase
      .from('cart_items')
      .select('*, product:products(*)')
      .order('created_at')
    setCartItems((data as unknown as CartItem[]) ?? [])
  }

  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, items:order_items(*, product:products(*))')
      .in('status', ['pending_approval', 'ordered'])
      .order('created_at', { ascending: false })
    setOrders((data as unknown as Order[]) ?? [])
    setLoading(false)
  }

  function updateBadge(cart: CartItem[], openOrders: Order[]) {
    const pending = openOrders.filter(o => o.status === 'pending_approval').length
    onBadgeChange(cart.length + pending)
  }

  // Group cart items by website domain (from supplier_url), fallback to supplier name
  const cartByDomain = cartItems.reduce<Record<string, CartItem[]>>((acc, item) => {
    const domain = getDomain(item.product?.supplier_url) ?? item.product?.preferred_supplier ?? 'Kein Lieferant'
    if (!acc[domain]) acc[domain] = []
    acc[domain].push(item)
    return acc
  }, {})

  const grandTotal = cartItems.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)

  async function updateQuantity(id: string, quantity: number) {
    if (quantity < 1) return removeItem(id)
    await supabase.from('cart_items').update({ quantity }).eq('id', id)
    const updated = cartItems.map(i => i.id === id ? { ...i, quantity } : i)
    setCartItems(updated)
    updateBadge(updated, orders)
  }

  async function removeItem(id: string) {
    await supabase.from('cart_items').delete().eq('id', id)
    const updated = cartItems.filter(i => i.id !== id)
    setCartItems(updated)
    updateBadge(updated, orders)
  }

  function showToast(message: string, onUndo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, onUndo })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  async function confirmDelete(item: CartItem) {
    setDeleteConfirm(null)
    await removeItem(item.id)
    showToast(`${item.product?.name ?? 'Artikel'} aus dem Warenkorb entfernt`, async () => {
      // Undo: re-insert the cart item
      const { data: restored } = await supabase
        .from('cart_items')
        .insert({ product_id: item.product_id, quantity: item.quantity })
        .select('*, product:products(*)')
        .single()
      if (restored) {
        const updated = [...cartItems.filter(i => i.id !== item.id), restored as unknown as CartItem]
        setCartItems(updated)
        updateBadge(updated, orders)
      } else {
        await fetchCart()
      }
      setToast(null)
    })
  }

  async function placeOrderForItem(item: CartItem) {
    setPlacingItem(item.id)
    const total = item.quantity * (item.product?.last_price ?? 0)
    const needsApproval = total >= APPROVAL_THRESHOLD
    const supplier = item.product?.preferred_supplier ?? 'Kein Lieferant'

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        created_by: user.id,
        supplier,
        status: needsApproval ? 'pending_approval' : 'ordered',
        total_estimate: total,
      })
      .select()
      .single()

    if (error || !order) { setPlacingItem(null); return }

    await supabase.from('order_items').insert({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      estimated_price: item.product?.last_price ?? null,
    })

    await supabase.from('cart_items').delete().eq('id', item.id)

    fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total, supplier, needs_approval: needsApproval }),
    }).catch(() => null)

    setPlacingItem(null)
    showToast(needsApproval
      ? `${item.product?.name ?? 'Artikel'} zur Genehmigung eingereicht`
      : `${item.product?.name ?? 'Artikel'} als bestellt markiert`
    )
    await Promise.all([fetchCart(), fetchOrders()])
  }

  async function approveOrder(orderId: string) {
    await supabase.from('orders').update({ status: 'ordered', approved_by: user.id }).eq('id', orderId)
    fetchOrders()
  }


  const openCount = orders.length
  const cartCount = cartItems.length

  return (
    <div className="w-full relative">
      {/* Tab switcher */}
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10 px-4">
        <TabButton active={tab === 'cart'} onClick={() => setTab('cart')} badge={cartCount}>
          Warenkorb
        </TabButton>
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} badge={openCount}>
          Offen
        </TabButton>
      </div>

      <div>
        {/* ── Cart tab ── */}
        {tab === 'cart' && (
          cartItems.length === 0 ? (
            <div className="text-center py-16 px-4">
              <ShoppingCart size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Warenkorb ist leer</p>
              <p className="text-xs text-slate-300 mt-1">Artikel über das Lager hinzufügen</p>
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(cartByDomain).map(([domain, items], idx) => {
                    const domainTotal = items.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)
                    return (
                      <>
                        {/* Spacer between groups */}
                        {idx > 0 && (
                          <tr key={`spacer-${domain}`}><td colSpan={7} className="h-4 bg-slate-100" /></tr>
                        )}
                        {/* Domain title row */}
                        <tr key={`domain-${domain}`} className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={7} className="px-4 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold text-slate-800 text-base">{domain}</p>
                              <span className="text-xs text-slate-500 hidden sm:inline">
                                Gesamt: <span className="font-semibold text-slate-700">€ {domainTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </span>
                            </div>
                          </td>
                        </tr>
                        {/* Column headers */}
                        <tr key={`cols-${domain}`} className="border-b border-slate-200 bg-white">
                          <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Artikel</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Bestand</th>
                          <th className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Menge</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Einheit</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
                          <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Website</th>
                          <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Aktion</th>
                        </tr>
                        {/* Item rows */}
                        {items.map(item => (
                          <CartItemRow
                            key={item.id}
                            item={item}
                            placing={placingItem === item.id}
                            onUpdateQuantity={updateQuantity}
                            onPlaceOrder={placeOrderForItem}
                            onRemoveRequest={setDeleteConfirm}
                          />
                        ))}
                      </>
                    )
                  })}
                </tbody>
              </table>

              {/* Grand total — only when multiple domains */}
              {Object.keys(cartByDomain).length > 1 && (
                <div className="px-4 py-3 flex items-center justify-between border-t border-slate-200">
                  <p className="text-sm font-medium text-slate-600">Gesamtsumme Warenkorb</p>
                  <p className="text-lg font-bold text-slate-800">
                    € {grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              )}
            </div>
          )
        )}

        {/* ── Open orders tab ── */}
        {tab === 'open' && (
          loading ? (
            <div className="flex justify-center py-16 px-4">
              <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Package size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Keine offenen Bestellungen</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {orders.map((order, idx) => (
                  <OpenOrderSection
                    key={order.id}
                    order={order}
                    role={role}
                    userId={user.id}
                    isFirst={idx === 0}
                    onApprove={() => approveOrder(order.id)}
                    onOrderReceived={fetchOrders}
                  />
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 text-base mb-1">Aus Warenkorb entfernen?</h3>
            <p className="text-sm text-slate-500 mb-5">
              <span className="font-medium text-slate-700">{deleteConfirm.product?.name}</span> wird aus dem Warenkorb gelöscht.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirm)}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
              >
                Entfernen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-lg">
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              onClick={toast.onUndo}
              className="flex items-center gap-1 text-sky-300 hover:text-sky-200 transition-colors whitespace-nowrap"
            >
              <Undo2 size={13} /> Rückgängig
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Cart item row ───────────────────────────────────────────────────────────
function CartItemRow({ item, placing, onUpdateQuantity, onPlaceOrder, onRemoveRequest }: {
  item: CartItem
  placing: boolean
  onUpdateQuantity: (id: string, qty: number) => void
  onPlaceOrder: (item: CartItem) => void
  onRemoveRequest: (item: CartItem) => void
}) {
  const rowTotal = item.quantity * (item.product?.last_price ?? 0)
  const needsApproval = rowTotal >= APPROVAL_THRESHOLD

  return (
    <tr className="bg-white hover:bg-slate-50 transition-colors border-b border-slate-100">
      <td className="px-4 py-3.5">
        <p className="text-sm font-semibold text-slate-800 truncate max-w-[180px] md:max-w-xs">{item.product?.name}</p>
        {item.product?.alternative_price != null &&
         item.product?.last_price != null &&
         item.product.alternative_price < item.product.last_price && (
          <a href={item.product.alternative_url ?? undefined}
            target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-emerald-600 mt-0.5">
            <ExternalLink size={10} />
            Günstiger: € {item.product.alternative_price} bij {item.product.alternative_supplier ?? 'Alternativlieferant'}
          </a>
        )}
      </td>
      {/* Current stock */}
      <td className="px-4 py-3.5 text-right hidden md:table-cell">
        <span className="text-sm font-bold text-slate-800">{item.product?.current_stock ?? '—'}</span>
        {item.product?.unit && <span className="text-xs text-slate-400 ml-1">{item.product.unit}</span>}
      </td>
      {/* Order quantity */}
      <td className="px-3 py-3.5">
        <div className="flex items-center gap-1 justify-center">
          <button
            onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <Minus size={11} />
          </button>
          <span className="w-7 text-center font-semibold text-slate-800">{item.quantity}</span>
          <button
            onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <Plus size={11} />
          </button>
        </div>
      </td>
      <td className="px-3 py-3.5 text-right text-slate-500 whitespace-nowrap hidden sm:table-cell">
        {item.product?.last_price != null
          ? `€ ${item.product.last_price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—'
        }
      </td>
      <td className="px-3 py-3.5 text-right font-semibold text-slate-800 whitespace-nowrap">
        € {rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      {/* Website link */}
      <td className="px-3 py-3.5 hidden sm:table-cell">
        {item.product?.supplier_url ? (
          <a href={item.product.supplier_url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 whitespace-nowrap">
            <ExternalLink size={12} />
            Website öffnen
          </a>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      {/* Two-step order action + delete */}
      <td className="px-3 py-3.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onRemoveRequest(item)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors whitespace-nowrap"
          >
            <Trash2 size={12} /> Entfernen
          </button>
          <button
            onClick={() => onPlaceOrder(item)}
            disabled={placing}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
              needsApproval
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-sky-500 hover:bg-sky-600 text-white'
            }`}
          >
            {placing ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
            ) : needsApproval ? (
              <><AlertCircle size={12} /> Zur Genehmigung</>
            ) : (
              <><CheckCircle size={12} /> Als bestellt markieren</>
            )}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Tab button ─────────────────────────────────────────────────────────────
function TabButton({ active, onClick, badge, children }: {
  active: boolean; onClick: () => void; badge?: number; children: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className={`py-3 px-1 mr-6 text-sm font-medium inline-flex items-center gap-2 border-b-2 transition-colors ${
        active ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
      {!!badge && badge > 0 && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
          active ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'
        }`}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Open order section ─────────────────────────────────────────────────────
function OpenOrderSection({ order, role, userId, isFirst, onApprove, onOrderReceived }: {
  order: Order; role: Role | null; userId: string; isFirst: boolean
  onApprove: () => void; onOrderReceived: () => void
}) {
  const [receivedIds, setReceivedIds] = useState<Set<string>>(new Set())
  const [receivingId, setReceivingId] = useState<string | null>(null)

  const isPending = order.status === 'pending_approval'
  const items = order.items ?? []
  const domain = getDomain(items[0]?.product?.supplier_url) ?? order.supplier ?? 'Unbekannter Lieferant'

  async function receiveItem(item: OrderItem) {
    if (!item.product_id) return
    setReceivingId(item.id)
    const { data: fresh } = await supabase.from('products').select('current_stock').eq('id', item.product_id).single()
    const currentStock = fresh?.current_stock ?? 0
    await supabase.from('products').update({ current_stock: currentStock + item.quantity }).eq('id', item.product_id)
    await supabase.from('stock_movements').insert({ product_id: item.product_id, type: 'manual_in', quantity: item.quantity, scanned_by: userId })
    const newSet = new Set([...receivedIds, item.id])
    setReceivedIds(newSet)
    setReceivingId(null)
    if (newSet.size === items.length) {
      await supabase.from('orders').update({ status: 'received' }).eq('id', order.id)
      onOrderReceived()
    }
  }

  return (
    <>
      {/* Spacer between orders */}
      {!isFirst && <tr><td colSpan={5} className="h-4 bg-slate-100" /></tr>}

      {/* Domain / supplier header row */}
      <tr className="border-t border-slate-200 bg-slate-50">
        <td colSpan={5} className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="font-semibold text-slate-800 text-base">{domain}</p>
              <span className="text-sm text-slate-400">
                {new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                isPending ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
              }`}>
                {isPending ? 'Ausstehend' : 'Bestellt'}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {order.total_estimate != null && (
                <span className="text-xs text-slate-500 hidden sm:inline">
                  Gesamt: <span className="font-semibold text-slate-700">€ {order.total_estimate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </span>
              )}
              {isPending && role === 'admin' && (
                <button onClick={onApprove}
                  className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                  <CheckCircle size={12} /> Genehmigen
                </button>
              )}
            </div>
          </div>
        </td>
      </tr>

      {/* Column headers */}
      <tr className="border-b border-slate-200 bg-white">
        <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-3">Artikel</th>
        <th className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Menge</th>
        <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap hidden sm:table-cell">Preis/Einheit</th>
        <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Gesamt</th>
        <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 py-3 whitespace-nowrap">Aktion</th>
      </tr>

      {/* Item rows */}
      {items.map(item => {
        const done = receivedIds.has(item.id)
        const rowTotal = item.quantity * (item.estimated_price ?? 0)
        return (
          <tr key={item.id} className={`border-b border-slate-100 transition-colors ${done ? 'bg-emerald-50/50' : 'bg-white hover:bg-slate-50'}`}>
            <td className="px-4 py-3.5">
              <p className={`text-sm font-semibold truncate max-w-[180px] md:max-w-xs ${done ? 'text-slate-400' : 'text-slate-800'}`}>{item.product?.name ?? '—'}</p>
            </td>
            <td className="px-3 py-3.5 text-center text-slate-500">{item.quantity}×</td>
            <td className="px-3 py-3.5 text-right text-slate-500 whitespace-nowrap hidden sm:table-cell">
              {item.estimated_price != null
                ? `€ ${item.estimated_price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </td>
            <td className="px-3 py-3.5 text-right font-semibold text-slate-800 whitespace-nowrap">
              {item.estimated_price != null
                ? `€ ${rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </td>
            <td className="px-3 py-3.5 text-right">
              {done ? (
                <span className="flex items-center justify-end gap-1.5 text-xs text-emerald-600 font-medium">
                  <Check size={13} /> Erhalten
                </span>
              ) : (
                <button
                  onClick={() => receiveItem(item)}
                  disabled={receivingId === item.id || isPending}
                  className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ml-auto"
                >
                  {receivingId === item.id
                    ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                    : <Package size={12} />
                  }
                  Lieferung erhalten
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}
