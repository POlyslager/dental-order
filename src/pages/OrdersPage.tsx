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

    // Send push notification to admins
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
    <div className="max-w-2xl mx-auto">
      {/* Tab switcher */}
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10">
        <TabButton active={tab === 'cart'} onClick={() => setTab('cart')} badge={cartCount}>
          Warenkorb
        </TabButton>
        <TabButton active={tab === 'open'} onClick={() => setTab('open')} badge={openCount}>
          Offen
        </TabButton>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Cart tab ── */}
        {tab === 'cart' && (
          cartItems.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Warenkorb ist leer</p>
              <p className="text-xs text-slate-300 mt-1">Artikel über das Lager hinzufügen</p>
            </div>
          ) : (
            Object.entries(cartBySupplier).map(([supplier, items]) => {
              const total = items.reduce((s, i) => s + (i.quantity * (i.product?.last_price ?? 0)), 0)
              const needsApproval = total >= APPROVAL_THRESHOLD
              return (
                <div key={supplier} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <p className="font-semibold text-slate-800 text-sm">{supplier}</p>
                    {needsApproval && (
                      <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        <AlertCircle size={11} /> Genehmigung nötig
                      </span>
                    )}
                  </div>

                  <div className="divide-y divide-slate-50">
                    {items.map(item => (
                      <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{item.product?.name}</p>
                          {item.product?.last_price != null && (
                            <p className="text-xs text-slate-400">
                              € {item.product.last_price} / {item.product.unit}
                            </p>
                          )}
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
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                            <Minus size={12} />
                          </button>
                          <span className="w-8 text-center text-sm font-semibold text-slate-800">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                            <Plus size={12} />
                          </button>
                        </div>
                        <button onClick={() => removeItem(item.id)} className="text-slate-300 hover:text-red-400 ml-1">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-3">
                    {/* Supplier website link */}
                    {items[0]?.product?.supplier_url && (
                      <a
                        href={items[0].product.supplier_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full border border-slate-300 rounded-xl py-2.5 text-sm text-slate-600 hover:bg-white transition-colors"
                      >
                        <ExternalLink size={14} />
                        Website öffnen — {supplier}
                      </a>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-400">Gesamt</p>
                        <p className="text-base font-bold text-slate-800">
                          € {total.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <button
                        onClick={() => placeOrder(supplier, items)}
                        disabled={placing === supplier}
                        className="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
                      >
                        {placing === supplier ? 'Wird gespeichert…' : needsApproval ? 'Zur Genehmigung' : 'Als bestellt markieren'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
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
            orders.map(order => (
              <OrderCard key={order.id} order={order} role={role}
                onApprove={() => approveOrder(order.id)}
                onReceive={() => markReceived(order)}
              />
            ))
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
      className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${
        active ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500'
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

// ── Order card ─────────────────────────────────────────────────────────────
function OrderCard({ order, role, onApprove, onReceive }: {
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
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${isPending ? 'border-amber-200' : 'border-slate-200'}`}>
      {isPending && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2">
          <AlertCircle size={14} className="text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700 font-medium">Genehmigung erforderlich</p>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm">{order.supplier ?? 'Unbekannter Lieferant'}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </p>
          </div>
          <div className="text-right shrink-0">
            {order.total_estimate != null && (
              <p className="text-base font-bold text-slate-800">
                € {order.total_estimate.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
              </p>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full ${isPending ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
              {isPending ? 'Ausstehend' : 'Bestellt'}
            </span>
          </div>
        </div>

        {/* Items toggle */}
        <button onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between mt-3 pt-3 border-t border-slate-50 text-left">
          <span className="text-xs text-slate-400">{order.items?.length ?? 0} Artikel</span>
          <ChevronRight size={14} className={`text-slate-300 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>

        {expanded && (
          <div className="mt-2 space-y-1.5 pb-1">
            {order.items?.map(item => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 truncate flex-1">{item.product?.name ?? '—'}</span>
                <span className="text-slate-500 shrink-0 ml-3">{item.quantity}×</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-50">
          {isPending && role === 'admin' && (
            <button onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
              <CheckCircle size={15} /> Genehmigen
            </button>
          )}
          {order.status === 'ordered' && (
            <button onClick={handleReceive} disabled={receiving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
              <Package size={15} /> {receiving ? 'Wird verarbeitet…' : 'Lieferung erhalten'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
