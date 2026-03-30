import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

webpush.setVapidDetails(
  'mailto:admin@dentalorder.app',
  process.env.VITE_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const { order_id, reason, employee_id, supplier } = req.body
  if (!order_id) return res.status(400).json({ error: 'order_id required' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await supabase
    .from('orders')
    .update({ status: 'rejected', notes: reason ?? null })
    .eq('id', order_id)
    .eq('status', 'pending_approval')

  if (error) return res.status(500).json({ error: error.message })

  // Send push to employee if they have a subscription
  if (employee_id) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', employee_id)

    if (subs?.length) {
      const body = reason ? `${supplier ?? 'Bestellung'} – ${reason}` : (supplier ?? 'Bestellung abgelehnt')
      const payload = JSON.stringify({
        title: 'Bestellung abgelehnt',
        body,
        url: '/orders',
        intent: 'cart',
        orderId: order_id,
        notes: reason ?? null,
      })
      await Promise.all(
        subs.map(({ subscription }: { subscription: object }) =>
          webpush.sendNotification(subscription as webpush.PushSubscription, payload).catch(() => null)
        )
      )
    }
  }

  return res.json({ ok: true })
}
