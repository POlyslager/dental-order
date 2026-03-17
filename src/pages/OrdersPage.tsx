import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Order, OrderStatus, Role } from '../lib/types'

interface Props { role: Role | null; user: User }

const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  ordered: 'Ordered',
  received: 'Received',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  ordered: 'bg-sky-100 text-sky-700',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
}

export default function OrdersPage({ role, user }: Props) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
    setOrders(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [])

  async function createOrder() {
    const { data, error } = await supabase
      .from('orders')
      .insert({ created_by: user.id, status: 'draft' })
      .select()
      .single()
    if (!error && data) setOrders(prev => [data, ...prev])
  }

  async function submitForApproval(orderId: string) {
    await supabase.from('orders').update({ status: 'pending_approval' }).eq('id', orderId)
    fetchOrders()
  }

  async function approveOrder(orderId: string) {
    await supabase.from('orders').update({
      status: 'approved',
      approved_by: user.id,
    }).eq('id', orderId)
    fetchOrders()
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Orders</h2>
        <button
          onClick={createOrder}
          className="bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + New order
        </button>
      </div>

      {orders.length === 0 && (
        <p className="text-center text-slate-400 py-12">No orders yet</p>
      )}

      <div className="space-y-3">
        {orders.map(order => (
          <div key={order.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-400 font-mono">{order.id.slice(0, 8)}…</p>
                <p className="text-sm text-slate-500 mt-0.5">
                  {new Date(order.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[order.status]}`}>
                {STATUS_LABELS[order.status]}
              </span>
            </div>

            {order.notes && <p className="text-sm text-slate-600 mt-2">{order.notes}</p>}

            <div className="mt-3 flex gap-2">
              {order.status === 'draft' && order.created_by === user.id && (
                <button
                  onClick={() => submitForApproval(order.id)}
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg"
                >
                  Submit for approval
                </button>
              )}
              {order.status === 'pending_approval' && role === 'admin' && (
                <button
                  onClick={() => approveOrder(order.id)}
                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg"
                >
                  ✓ Approve
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
