import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails('mailto:admin@dentalorder.app', VAPID_PUBLIC, VAPID_PRIVATE)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { order_id, total, supplier, needs_approval } = await req.json()

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Get all admin user IDs
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (!admins?.length) return new Response('no admins', { headers: corsHeaders })

    // Get their push subscriptions
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .in('user_id', admins.map((a: { id: string }) => a.id))

    if (!subs?.length) return new Response('no subscriptions', { headers: corsHeaders })

    const title = needs_approval
      ? `Bestellung: Genehmigung nötig — € ${Math.round(total)}`
      : `Neue Bestellung — € ${Math.round(total)}`

    await Promise.all(
      subs.map(({ subscription }) =>
        webpush.sendNotification(
          subscription,
          JSON.stringify({ title, body: supplier ?? 'Bestellung aufgegeben', url: '/orders', tag: order_id })
        ).catch(() => null)
      )
    )

    return new Response(JSON.stringify({ sent: subs.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(String(err), { status: 500, headers: corsHeaders })
  }
})
