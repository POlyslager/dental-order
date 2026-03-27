import { useState } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import { Delete } from 'lucide-react'

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

export default function LoginPage() {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)

  async function submitPin(p: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/pin-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ pin: p }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Falsche PIN')
        setPin('')
        setShake(true)
        setTimeout(() => setShake(false), 600)
      } else {
        await supabase.auth.setSession({
          access_token: json.access_token,
          refresh_token: json.refresh_token,
        })
      }
    } catch {
      setError('Verbindungsfehler')
      setPin('')
      setShake(true)
      setTimeout(() => setShake(false), 600)
    }
    setLoading(false)
  }

  function handleDigit(digit: string) {
    if (loading) return
    if (pin.length >= 6) return
    const next = pin + digit
    setPin(next)
    setError(null)
    if (next.length === 6) {
      submitPin(next)
    }
  }

  function handleBackspace() {
    if (loading) return
    setPin(p => p.slice(0, -1))
    setError(null)
  }

  return (
    <div className="h-svh overflow-hidden bg-gradient-to-br from-sky-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-xs bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 flex flex-col items-center gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <svg width="72" height="48" viewBox="0 0 100 65" fill="#38bdf8" xmlns="http://www.w3.org/2000/svg">
              <rect x="30" y="0" width="40" height="8" rx="1"/>
              <rect x="0" y="10" width="100" height="11" rx="1"/>
              <path d="M1 23 L19 23 L17.5 63 L2.5 63 Z"/>
              <path d="M21 23 L39 23 L37.5 63 L22.5 63 Z"/>
              <path d="M41 23 L59 23 L57.5 63 L42.5 63 Z"/>
              <path d="M61 23 L79 23 L77.5 63 L62.5 63 Z"/>
              <path d="M81 23 L99 23 L97.5 63 L82.5 63 Z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">DentalOrder</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Praxis Senefelder</p>
        </div>

        {/* PIN dots */}
        <div className={`flex gap-3 ${shake ? 'animate-shake' : ''}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                i < pin.length
                  ? error ? 'bg-red-500 scale-110' : 'bg-sky-500 scale-110'
                  : 'bg-slate-200 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 w-full text-center -mt-2">
            {error}
          </p>
        )}

        {/* Loading spinner */}
        {loading && (
          <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin -mt-2" />
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {NUMPAD_KEYS.map((key, i) =>
            key === '' ? (
              <div key={i} />
            ) : key === '⌫' ? (
              <button
                key={i}
                onClick={handleBackspace}
                disabled={loading}
                className="h-14 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 active:scale-95 text-slate-600 dark:text-slate-300 text-lg font-medium transition-all flex items-center justify-center disabled:opacity-40"
              >
                <Delete size={20} />
              </button>
            ) : (
              <button
                key={i}
                onClick={() => handleDigit(key)}
                disabled={loading || pin.length >= 6}
                className="h-14 rounded-2xl bg-slate-50 hover:bg-sky-50 hover:text-sky-700 active:scale-95 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 text-xl font-semibold transition-all border border-slate-200 dark:border-slate-600 hover:border-sky-200 disabled:opacity-40"
              >
                {key}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
