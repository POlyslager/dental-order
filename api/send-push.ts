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

  const { total, supplier, needs_approval, title: customTitle, body: customBody, user_ids, intent } = req.body

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let targetIds: string[]
  if (user_ids?.length) {
    targetIds = user_ids
  } else {
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (!admins?.length) return res.json({ sent: 0 })
    targetIds = admins.map((a: { id: string }) => a.id)
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .in('user_id', targetIds)

  if (!subs?.length) return res.json({ sent: 0 })

  const title = customTitle ?? (needs_approval
    ? `Bestellung: Genehmigung nötig — € ${Math.round(total)}`
    : `Neue Bestellung — € ${Math.round(total)}`)
  const body = customBody ?? supplier ?? 'Bestellung aufgegeben'

  await Promise.all(
    subs.map(({ subscription }) =>
      webpush.sendNotification(
        subscription,
        JSON.stringify({ title, body, url: '/', intent: intent ?? 'approval' })
      ).catch(() => null)
    )
  )

  return res.json({ sent: subs.length })
}
