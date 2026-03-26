import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ScanLine, Flashlight, FlashlightOff } from 'lucide-react'
import type { Html5Qrcode } from 'html5-qrcode'

interface Props {
  divId: string
  onClose: () => void
  scannerRef?: React.RefObject<Html5Qrcode | null>
  onManualEntry?: (barcode: string) => void
}

export default function BarcodeScanModal({ divId, onClose, scannerRef, onManualEntry }: Props) {
  const [dragPos, setDragPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(16, Math.floor(window.innerWidth / 2) - 160) : 16,
    y: 90,
  }))
  const isDragging = useRef(false)
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 })

  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const torchChecked = useRef(false)
  const [manualInput, setManualInput] = useState('')

  // Detect torch support once the scanner is running
  useEffect(() => {
    if (torchChecked.current || !scannerRef) return
    const interval = setInterval(() => {
      try {
        const caps = scannerRef.current?.getRunningTrackCameraCapabilities()
        if (caps) {
          torchChecked.current = true
          clearInterval(interval)
          setTorchSupported(caps.torchFeature().isSupported())
        }
      } catch { /* not ready yet */ }
    }, 300)
    return () => clearInterval(interval)
  }, [scannerRef])

  async function toggleTorch() {
    if (!scannerRef?.current) return
    try {
      const caps = scannerRef.current.getRunningTrackCameraCapabilities()
      await caps.torchFeature().apply(!torchOn)
      setTorchOn(v => !v)
    } catch { /* torch failed — ignore */ }
  }

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!isDragging.current) return
      e.preventDefault()
      const point = 'touches' in e ? (e as TouchEvent).touches[0] : e as MouseEvent
      const dx = point.clientX - dragOrigin.current.mouseX
      const dy = point.clientY - dragOrigin.current.mouseY
      setDragPos({
        x: Math.max(0, Math.min(window.innerWidth - 320, dragOrigin.current.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 80, dragOrigin.current.posY + dy)),
      })
    }
    function onEnd() { isDragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('mouseup', onEnd)
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onEnd)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])

  function onDragStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const point = 'touches' in e ? e.touches[0] : e
    isDragging.current = true
    dragOrigin.current = { mouseX: point.clientX, mouseY: point.clientY, posX: dragPos.x, posY: dragPos.y }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = manualInput.trim()
    if (!val || !onManualEntry) return
    onManualEntry(val)
    setManualInput('')
  }

  return createPortal(
    <div
      className="fixed z-[200] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden select-none"
      style={{ left: dragPos.x, top: dragPos.y, width: 320 }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-transparent cursor-grab active:cursor-grabbing touch-none"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      >
        <div className="flex items-center gap-2">
          <ScanLine size={15} className="text-slate-400" />
          <span className="text-slate-700 dark:text-white text-sm font-medium">Barcode scannen</span>
        </div>
        <div className="flex items-center gap-1">
          {torchSupported && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              onClick={toggleTorch}
              className={`p-1 rounded transition-colors ${torchOn ? 'text-amber-400 hover:text-amber-300' : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'}`}
            >
              {torchOn ? <Flashlight size={16} /> : <FlashlightOff size={16} />}
            </button>
          )}
          <button
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div id={divId} className="w-full bg-slate-900" style={{ minHeight: 260 }} />
      {onManualEntry ? (
        <form onSubmit={handleManualSubmit} className="px-3 py-2 bg-slate-100 dark:bg-slate-900 flex gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="Barcode manuell eingeben…"
            className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            type="submit"
            disabled={!manualInput.trim()}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-medium transition-colors"
          >
            OK
          </button>
        </form>
      ) : (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-2 bg-slate-100 dark:bg-slate-900">Barcode vor die Kamera halten</p>
      )}
    </div>,
    document.body
  )
}
