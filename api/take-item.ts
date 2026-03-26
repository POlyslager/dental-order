import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { productId, quantity, userId } = req.body as { productId?: string; quantity?: number; userId?: string }
  if (!productId || !quantity || quantity <= 0) return res.status(400).json({ error: 'productId and quantity required' })

  // Fetch current stock, min_stock and name
  const { data: product, error: fetchErr } = await adminClient
    .from('products').select('current_stock, min_stock, name').eq('id', productId).single()
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

  // Send low-stock push notification if stock hit or crossed min_stock
  if (newStock <= product.min_stock && product.current_stock > product.min_stock) {
    try {
      webpush.setVapidDetails(
        'mailto:admin@dentalorder.app',
        process.env.VITE_VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!,
      )
      const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin')
      if (admins?.length) {
        const { data: subs } = await adminClient
          .from('push_subscriptions').select('subscription')
          .in('user_id', admins.map((a: { id: string }) => a.id))
        if (subs?.length) {
          const title = newStock === 0
            ? `${product.name} — Kein Bestand!`
            : `${product.name} — Niedriger Bestand`
          const body = newStock === 0
            ? 'Artikel ist aufgebraucht. Bitte nachbestellen.'
            : `Noch ${newStock} Einheit${newStock !== 1 ? 'en' : ''} verfügbar.`
          await Promise.all(subs.map(({ subscription }) =>
            webpush.sendNotification(subscription, JSON.stringify({ title, body, url: '/stock' })).catch(() => null)
          ))
        }
      }
    } catch { /* push is best-effort */ }
  }

  return res.status(200).json({ ok: true, newStock })
}
