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

  const { total, supplier, needs_approval } = req.body

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
  if (!admins?.length) return res.json({ sent: 0 })

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .in('user_id', admins.map((a: { id: string }) => a.id))

  if (!subs?.length) return res.json({ sent: 0 })

  const title = needs_approval
    ? `Bestellung: Genehmigung nötig — € ${Math.round(total)}`
    : `Neue Bestellung — € ${Math.round(total)}`

  await Promise.all(
    subs.map(({ subscription }) =>
      webpush.sendNotification(
        subscription,
        JSON.stringify({ title, body: supplier ?? 'Bestellung aufgegeben', url: '/orders' })
      ).catch(() => null)
    )
  )

  return res.json({ sent: subs.length })
}
