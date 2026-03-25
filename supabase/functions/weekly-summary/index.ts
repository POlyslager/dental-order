import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Base64url helpers ─────────────────────────────────────────────────────
function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4)
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

// ── Import raw P-256 private key (VAPID format) ───────────────────────────
async function importPrivateKey(rawB64url: string): Promise<CryptoKey> {
  const raw = b64urlDecode(rawB64url)
  const pkcs8 = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07,
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04,
    0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20, ...raw,
  ])
  return crypto.subtle.importKey(
    'pkcs8', pkcs8.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )
}

// ── Build VAPID Authorization header ─────────────────────────────────────
async function vapidAuth(endpoint: string, publicKey: string, privateKey: string): Promise<string> {
  const { protocol, host } = new URL(endpoint)
  const exp = Math.floor(Date.now() / 1000) + 43200
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: `${protocol}//${host}`, exp, sub: 'mailto:admin@dentalorder.app' })}`
  const key = await importPrivateKey(privateKey)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  return `vapid t=${unsigned}.${b64url(new Uint8Array(sig))},k=${publicKey}`
}

// ── Send one push (no payload — service worker uses its own message) ──────
async function sendPush(sub: { endpoint: string }, auth: string): Promise<void> {
  await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: auth, TTL: '86400', Urgency: 'normal' },
  })
}

// ── Edge function entry ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Fetch all push subscriptions (all users) ──────────────────────────
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')

    if (!subs?.length) return new Response('no subscriptions', { headers: CORS })

    // ── Fetch summary data ────────────────────────────────────────────────

    // Low-stock products: stock < min_stock (compare column to column via RPC-free approach)
    const { data: allProducts } = await supabase
      .from('products')
      .select('stock, min_stock')

    const lowStock = (allProducts ?? []).filter(
      (p: { stock: number; min_stock: number }) => p.stock < p.min_stock
    ).length

    // Products expiring within 30 days
    const now = new Date()
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const today = now.toISOString().split('T')[0]

    const { count: expiringCount } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .not('expiry_date', 'is', null)
      .gte('expiry_date', today)
      .lte('expiry_date', in30Days)

    // Total pending orders
    const { count: pendingOrdersCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    // Orders created this week (since last Monday)
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1))
    weekStart.setHours(0, 0, 0, 0)

    const { count: ordersThisWeek } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekStart.toISOString())

    const summary = {
      lowStock,
      expiring: expiringCount ?? 0,
      pendingOrders: pendingOrdersCount ?? 0,
      ordersThisWeek: ordersThisWeek ?? 0,
    }

    // ── Send push to all subscribers ──────────────────────────────────────
    const pub  = Deno.env.get('VAPID_PUBLIC_KEY')!
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')!

    await Promise.all(
      subs.map(async ({ subscription }: { subscription: { endpoint: string } }) => {
        const auth = await vapidAuth(subscription.endpoint, pub, priv)
        await sendPush(subscription, auth).catch(() => null)
      })
    )

    return new Response(JSON.stringify({ sent: subs.length, summary }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(String(err), { status: 500, headers: CORS })
  }
})

// -- Run in Supabase SQL editor to schedule weekly summary:
// select cron.schedule('weekly-summary', '0 8 * * 1', $$
//   select net.http_post(
//     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/weekly-summary',
//     headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
//     body := '{}'::jsonb
//   );
// $$);
