import { type ReactNode, useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
  zIndex?: number
}

export default function Drawer({ open, onClose, children, zIndex = 50 }: Props) {
  const scrollYRef = useRef(0)

  useEffect(() => {
    if (open) {
      // Save current scroll position and lock body (iOS-safe)
      scrollYRef.current = window.scrollY
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollYRef.current}px`
      document.body.style.width = '100%'
      document.body.style.overflowY = 'scroll'
    } else {
      // Restore scroll position
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      document.body.style.overflowY = ''
      window.scrollTo(0, scrollYRef.current)
    }
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      document.body.style.overflowY = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 flex flex-col justify-end" style={{ zIndex }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-white rounded-t-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: '92dvh' }}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>
        {children}
      </div>
    </div>
  )
}
