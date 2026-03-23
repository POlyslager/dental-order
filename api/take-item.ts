import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { productId, quantity, userId } = req.body as { productId?: string; quantity?: number; userId?: string }
  if (!productId || !quantity || quantity <= 0) return res.status(400).json({ error: 'productId and quantity required' })

  // Fetch current stock fresh
  const { data: product, error: fetchErr } = await adminClient
    .from('products').select('current_stock').eq('id', productId).single()
  if (fetchErr || !product) return res.status(404).json({ error: 'product not found' })

  const newStock = Math.max(0, product.current_stock - quantity)

  const { error: updateErr } = await adminClient
    .from('products').update({ current_stock: newStock }).eq('id', productId)
  if (updateErr) return res.status(500).json({ error: updateErr.message })

  await adminClient.from('stock_movements').insert({
    product_id: productId,
    type: 'scan_out',
    quantity,
    scanned_by: userId ?? '',
    notes: 'Entnommen über Artikeldetails',
  })

  return res.status(200).json({ ok: true, newStock })
}
