import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CartItem, Order, Role } from '../lib/types'
import { ShoppingCart, Package, Plus, Minus, Trash2, ChevronRight, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

const APPROVAL_THRESHOLD = 2000

interface Props { role: Role | null; user: User; onBadgeChange: (n: number) => void }

export default function OrdersPage({ role, user, onBadgeChange }: Props) {
  const [tab, setTab] = useState<'cart' | 'open'>('cart')
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState<string | null>(null)

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

  // Group cart by supplier
  const cartBySupplier = cartItems.reduce<Record<string, CartItem[]>>((acc, item) => {
    const supplier = item.product?.preferred_supplier ?? 'Kein Lieferant'
    if (!acc[supplier]) acc[supplier] = []
    acc[supplier].push(item)
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

  async function placeOrder(supplier: string, items: CartItem[]) {
    setPlacing(supplier)
    const total = items.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)
    const needsApproval = total >= APPROVAL_THRESHOLD

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

    if (error || !order) { setPlacing(null); return }

    await supabase.from('order_items').insert(
      items.map(i => ({
        order_id: order.id,
        product_id: i.product_id,
        quantity: i.quantity,
        estimated_price: i.product?.last_price ?? null,
      }))
    )

    await supabase.from('cart_items').delete().in('id', items.map(i => i.id))

    fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total, supplier, needs_approval: needsApproval }),
    }).catch(() => null)

    setPlacing(null)
    await Promise.all([fetchCart(), fetchOrders()])
    setTab('open')
  }

  async function approveOrder(orderId: string) {
    await supabase.from('orders').update({ status: 'ordered', approved_by: user.id }).eq('id', orderId)
    fetchOrders()
  }

  async function markReceived(order: Order) {
    for (const item of order.items ?? []) {
      if (!item.product_id || !item.product) continue
      await supabase.from('products')
        .update({ current_stock: item.product.current_stock + item.quantity })
        .eq('id', item.product_id)
      await supabase.from('stock_movements').insert({
        product_id: item.product_id,
        type: 'manual_in',
        quantity: item.quantity,
        scanned_by: user.id,
      })
    }
    await supabase.from('orders').update({ status: 'received' }).eq('id', order.id)
    fetchOrders()
  }

  const openCount = orders.length
  const cartCount = cartItems.length

  return (
    <div className="w-full">
      {/* Tab switcher */}
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10 px-4">
        <TabButton active={tab === 'cart'} onClick={() => setTab('cart')} badge={cartCount}>
          Warenkorb
        </TabButton>
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} badge={openCount}>
          Offen
        </TabButton>
      </div>

      <div className="p-4">
        {/* ── Cart tab ── */}
        {tab === 'cart' && (
          cartItems.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Warenkorb ist leer</p>
              <p className="text-xs text-slate-300 mt-1">Artikel über das Lager hinzufügen</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(cartBySupplier).map(([supplier, items]) => {
                const supplierTotal = items.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)
                const needsApproval = supplierTotal >= APPROVAL_THRESHOLD
                const supplierUrl = items[0]?.product?.supplier_url
                return (
                  <div key={supplier} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Supplier header */}
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm">{supplier}</p>
                        {needsApproval && (
                          <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0">
                            <AlertCircle size={11} /> Genehmigung nötig
                          </span>
                        )}
                      </div>
                      {supplierUrl && (
                        <a
                          href={supplierUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
                        >
                          <ExternalLink size={12} />
                          <span className="hidden sm:inline">Website öffnen</span>
                          <span className="sm:hidden">Bestellen</span>
                        </a>
                      )}
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 w-full">Artikel</th>
                            <th className="text-center px-3 py-2 text-xs font-medium text-slate-400 whitespace-nowrap">Menge</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 whitespace-nowrap hidden sm:table-cell">Preis/Einheit</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 whitespace-nowrap">Gesamt</th>
                            <th className="px-3 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {items.map(item => {
                            const rowTotal = item.quantity * (item.product?.last_price ?? 0)
                            return (
                              <tr key={item.id} className="hover:bg-slate-50/50">
                                <td className="px-4 py-3">
                                  <p className="font-medium text-slate-800 truncate max-w-[200px] md:max-w-xs">{item.product?.name}</p>
                                  {item.product?.alternative_price != null &&
                                   item.product?.last_price != null &&
                                   item.product.alternative_price < item.product.last_price && (
                                    <a href={item.product.alternative_url ?? undefined}
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="flex items-center gap-1 text-xs text-emerald-600 mt-0.5">
                                      <ExternalLink size={10} />
                                      Günstiger: € {item.product.alternative_price} bei {item.product.alternative_supplier ?? 'Alternativlieferant'}
                                    </a>
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1 justify-center">
                                    <button
                                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                      className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                    >
                                      <Minus size={11} />
                                    </button>
                                    <span className="w-7 text-center font-semibold text-slate-800">{item.quantity}</span>
                                    <button
                                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                      className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                    >
                                      <Plus size={11} />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-right text-slate-500 whitespace-nowrap hidden sm:table-cell">
                                  {item.product?.last_price != null
                                    ? `€ ${item.product.last_price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'
                                  }
                                </td>
                                <td className="px-3 py-3 text-right font-medium text-slate-800 whitespace-nowrap">
                                  € {rowTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-3 py-3">
                                  <button
                                    onClick={() => removeItem(item.id)}
                                    className="text-slate-300 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Supplier footer: total + action */}
                    <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-400">Lieferant gesamt</p>
                        <p className="text-base font-bold text-slate-800">
                          € {supplierTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <button
                        onClick={() => placeOrder(supplier, items)}
                        disabled={placing === supplier}
                        className="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shrink-0"
                      >
                        {placing === supplier ? 'Wird gespeichert…' : needsApproval ? 'Zur Genehmigung' : 'Als bestellt markieren'}
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* Grand total */}
              {Object.keys(cartBySupplier).length > 1 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex items-center justify-between">
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
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <Package size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Keine offenen Bestellungen</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Lieferant</th>
                      <th className="text-left px-3 py-3 text-xs font-medium text-slate-400 hidden sm:table-cell">Datum</th>
                      <th className="text-center px-3 py-3 text-xs font-medium text-slate-400 hidden md:table-cell">Artikel</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-slate-400">Gesamt</th>
                      <th className="text-center px-3 py-3 text-xs font-medium text-slate-400">Status</th>
                      <th className="px-3 py-3 text-xs font-medium text-slate-400 text-right">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map(order => (
                      <OpenOrderRow
                        key={order.id}
                        order={order}
                        role={role}
                        onApprove={() => approveOrder(order.id)}
                        onReceive={() => markReceived(order)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    </div>
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

// ── Open order row ─────────────────────────────────────────────────────────
function OpenOrderRow({ order, role, onApprove, onReceive }: {
  order: Order; role: Role | null; onApprove: () => void; onReceive: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const isPending = order.status === 'pending_approval'

  async function handleReceive() {
    setReceiving(true)
    await onReceive()
    setReceiving(false)
  }

  return (
    <>
      <tr className={`hover:bg-slate-50/50 ${isPending ? 'bg-amber-50/40' : ''}`}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-slate-300 hover:text-slate-500 transition-colors shrink-0"
            >
              <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
            <span className="font-medium text-slate-800">{order.supplier ?? 'Unbekannter Lieferant'}</span>
          </div>
        </td>
        <td className="px-3 py-3 text-slate-500 whitespace-nowrap hidden sm:table-cell">
          {new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </td>
        <td className="px-3 py-3 text-center text-slate-500 hidden md:table-cell">
          {order.items?.length ?? 0}
        </td>
        <td className="px-3 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">
          {order.total_estimate != null
            ? `€ ${order.total_estimate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '—'
          }
        </td>
        <td className="px-3 py-3 text-center">
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
            isPending ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
          }`}>
            {isPending ? 'Ausstehend' : 'Bestellt'}
          </span>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center justify-end gap-2">
            {isPending && role === 'admin' && (
              <button
                onClick={onApprove}
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                <CheckCircle size={13} /> Genehmigen
              </button>
            )}
            {order.status === 'ordered' && (
              <button
                onClick={handleReceive}
                disabled={receiving}
                className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                <Package size={13} /> {receiving ? 'Wird verarbeitet…' : 'Lieferung erhalten'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded items row */}
      {expanded && (
        <tr className={isPending ? 'bg-amber-50/20' : 'bg-slate-50/50'}>
          <td colSpan={6} className="px-4 pb-3 pt-0">
            <div className="ml-6 space-y-1">
              {order.items?.map(item => (
                <div key={item.id} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-slate-600">{item.product?.name ?? '—'}</span>
                  <span className="text-slate-400 shrink-0 ml-4">{item.quantity}×</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
