import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { pin } = await req.json()
    if (!pin || typeof pin !== 'string') {
      return new Response(JSON.stringify({ error: 'Ungültige Anfrage' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const hash = await sha256hex(pin)

    // Service role client to read settings table
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: settings } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['employee_pin_hash', 'admin_pin_hash'])

    const employeeHash = settings?.find((r: { key: string; value: string }) => r.key === 'employee_pin_hash')?.value
    const adminHash    = settings?.find((r: { key: string; value: string }) => r.key === 'admin_pin_hash')?.value

    let email: string | null = null
    let password: string | null = null

    if (hash === adminHash) {
      email    = Deno.env.get('ADMIN_EMAIL')!
      password = Deno.env.get('ADMIN_PASSWORD')!
    } else if (hash === employeeHash) {
      email    = Deno.env.get('EMPLOYEE_EMAIL')!
      password = Deno.env.get('EMPLOYEE_PASSWORD')!
    } else {
      return new Response(JSON.stringify({ error: 'Falsche PIN' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Anon client for sign-in
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    )

    const { data, error } = await anonClient.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      return new Response(JSON.stringify({ error: error?.message ?? 'Login fehlgeschlagen' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data.session), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(String(err), { status: 500, headers: CORS })
  }
})
