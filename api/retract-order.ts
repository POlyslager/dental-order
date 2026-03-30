import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const { order_ids, original_total, new_total, retracted_by } = req.body
  if (!order_ids?.length) return res.json({ ok: true })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'retracted',
      notes: JSON.stringify({
        original_total,
        new_total,
        retracted_by,
        retracted_at: new Date().toISOString(),
      }),
    })
    .in('id', order_ids)
    .eq('status', 'pending_approval')

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ ok: true })
}
