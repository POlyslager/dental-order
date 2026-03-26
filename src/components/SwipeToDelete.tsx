import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  onDelete: () => void
  children: React.ReactNode
  disabled?: boolean
}

const REVEAL = 72    // width of red delete area
const THRESHOLD = 56 // minimum swipe to auto-confirm

export default function SwipeToDelete({ onDelete, children, disabled }: Props) {
  const [offset, setOffset] = useState(0)
  const startX = useRef(0)
  const startY = useRef(0)
  const direction = useRef<'h' | 'v' | null>(null)
  const active = useRef(false)

  function onTouchStart(e: React.TouchEvent) {
    if (disabled) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    direction.current = null
    active.current = true
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!active.current || disabled) return
    const dx = startX.current - e.touches[0].clientX
    const dy = Math.abs(e.touches[0].clientY - startY.current)

    if (!direction.current) {
      if (Math.abs(dx) < 6 && dy < 6) return
      direction.current = Math.abs(dx) >= dy ? 'h' : 'v'
    }
    if (direction.current === 'v') return

    e.preventDefault()
    setOffset(Math.max(0, Math.min(REVEAL + 16, dx)))
  }

  function onTouchEnd() {
    if (!active.current) return
    active.current = false
    if (offset >= THRESHOLD) {
      onDelete()
      setOffset(0)
    } else {
      setOffset(0)
    }
  }

  const swiped = direction.current === 'h' && offset > 4

  return (
    <div className="relative overflow-hidden">
      {/* Delete background */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500"
        style={{ width: REVEAL }}
      >
        <Trash2 size={18} className="text-white" />
      </div>
      {/* Row content */}
      <div
        style={{
          transform: `translateX(-${offset}px)`,
          transition: active.current ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={e => { if (swiped) e.stopPropagation() }}
      >
        {children}
      </div>
    </div>
  )
}
