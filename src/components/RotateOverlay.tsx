import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw } from 'lucide-react'

export default function RotateOverlay() {
  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    function handler(e: MediaQueryListEvent) { setIsPortrait(e.matches) }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  if (!isPortrait) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-900 flex flex-col items-center justify-center gap-6 text-white">
      <RotateCcw size={48} className="text-sky-400 animate-spin-slow" />
      <div className="text-center px-8">
        <p className="text-xl font-semibold mb-2">Bitte Gerät drehen</p>
        <p className="text-sm text-slate-400">Diese App ist für den Querformat-Betrieb optimiert.</p>
      </div>
    </div>,
    document.body
  )
}
