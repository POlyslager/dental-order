import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hashPin } from '../lib/pin'

interface Props {
  userId: string
  onVerified: () => void
}

export default function PinPage({ userId, onVerified }: Props) {
  const [pin, setPin] = useState('')
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('pin_hash')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        setPinHash(data?.pin_hash ?? null)
        setLoading(false)
      })
  }, [userId])

  async function handleDigit(d: string) {
    if (pin.length >= 6) return
    const next = pin + d
    setPin(next)
    setError(false)
    if (next.length === 6) {
      const hash = await hashPin(next)
      if (hash === pinHash) {
        onVerified()
      } else {
        setError(true)
        setTimeout(() => setPin(''), 600)
      }
    }
  }

  function handleBackspace() {
    setPin(p => p.slice(0, -1))
    setError(false)
  }

  if (loading) {
    return (
      <div className="h-svh flex items-center justify-center bg-gradient-to-br from-sky-50 to-slate-100">
        <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div className="h-svh overflow-hidden bg-gradient-to-br from-sky-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-xs bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="text-5xl mb-3">🦷</div>
          <h1 className="text-xl font-semibold text-slate-800">PIN eingeben</h1>
          <p className="text-slate-500 text-sm mt-1">Bitte geben Sie Ihre 6-stellige PIN ein</p>
        </div>

        {/* Dots */}
        <div className="flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-all duration-150 ${
                i < pin.length
                  ? error ? 'bg-red-500 scale-110' : 'bg-sky-500 scale-110'
                  : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-red-500 text-sm -mt-3">Falsche PIN. Bitte erneut versuchen.</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {numpadKeys.map((key, i) =>
            key === '' ? (
              <div key={i} />
            ) : key === '⌫' ? (
              <button
                key={i}
                onClick={handleBackspace}
                className="h-14 rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 text-lg font-medium transition-all flex items-center justify-center"
              >
                ⌫
              </button>
            ) : (
              <button
                key={i}
                onClick={() => handleDigit(key)}
                className="h-14 rounded-2xl bg-slate-50 hover:bg-sky-50 hover:text-sky-700 active:scale-95 text-slate-800 text-lg font-semibold transition-all border border-slate-200 hover:border-sky-200"
              >
                {key}
              </button>
            )
          )}
        </div>

        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          Abmelden
        </button>
      </div>
    </div>
  )
}
