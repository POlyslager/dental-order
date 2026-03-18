const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function subscribeToPush(userId: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return

  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as string,
    })

    const { supabase } = await import('./supabase')
    await supabase.from('push_subscriptions').upsert(
      { user_id: userId, subscription: sub.toJSON() },
      { onConflict: 'user_id' }
    )
  } catch {
    // Push not supported or user blocked — fail silently
  }
}
