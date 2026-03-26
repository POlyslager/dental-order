import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'

interface Props {
  message: string
  onClose: () => void
  onUndo?: () => void
}

export default function Toast({ message, onClose, onUndo }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [message, onClose])

  return createPortal(
    <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 animate-slide-in-down">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
          <Check size={16} className="text-emerald-400" />
        </div>
        <p className="flex-1 text-sm font-medium leading-snug">{message}</p>
        {onUndo && (
          <button onClick={() => { onUndo(); onClose() }}
            className="text-sky-400 hover:text-sky-300 text-sm font-medium shrink-0 transition-colors">
            Rückgängig
          </button>
        )}
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0 flex items-center">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body
  )
}
