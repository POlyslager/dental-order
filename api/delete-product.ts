import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).end()

  const { id } = req.body as { id?: string }
  if (!id) return res.status(400).json({ error: 'id required' })

  await adminClient.from('stock_movements').delete().eq('product_id', id)
  await adminClient.from('cart_items').delete().eq('product_id', id)
  await adminClient.from('order_items').delete().eq('product_id', id)
  const { data, error } = await adminClient.from('products').delete().eq('id', id).select('id')

  if (error) return res.status(500).json({ error: error.message })
  if (!data || data.length === 0) return res.status(404).json({ error: 'not found' })

  return res.status(200).json({ ok: true })
}
