import { useEffect, useState } from 'react'
import { X, KeyRound, Eye, EyeOff, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { hashPin } from '../lib/pin'

type RoleKey = 'employee' | 'admin'
type View = 'overview' | 'pin-enter' | 'pin-confirm' | 'cred-edit'

interface PinState {
  role: RoleKey | null
  pin: string
  pinConfirm: string
  error: string | null
  saving: boolean
}

interface Credentials {
  employee_email: string
  employee_password: string
  admin_email: string
  admin_password: string
}

interface CredEditState {
  role: RoleKey
  email: string
  password: string
  saving: boolean
  error: string | null
}

const ROLE_LABEL: Record<RoleKey, string> = {
  employee: 'Mitarbeiter',
  admin: 'Admin',
}

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

interface Props { onClose: () => void }

export default function PinSettingsModal({ onClose }: Props) {
  const [view, setView] = useState<View>('overview')
  const [success, setSuccess] = useState<string | null>(null)

  // PIN change state
  const [pinState, setPinState] = useState<PinState>({ role: null, pin: '', pinConfirm: '', error: null, saving: false })

  // Credentials state
  const [creds, setCreds] = useState<Credentials>({ employee_email: '', employee_password: '', admin_email: '', admin_password: '' })
  const [credsLoading, setCredsLoading] = useState(true)
  const [showPw, setShowPw] = useState<Record<RoleKey, boolean>>({ employee: false, admin: false })
  const [credEdit, setCredEdit] = useState<CredEditState | null>(null)

  useEffect(() => {
    supabase
      .from('settings')
      .select('key, value')
      .in('key', ['employee_email', 'employee_password', 'admin_email', 'admin_password'])
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const r of data ?? []) map[r.key] = r.value
        setCreds({
          employee_email:    map['employee_email']    ?? '',
          employee_password: map['employee_password'] ?? '',
          admin_email:       map['admin_email']       ?? '',
          admin_password:    map['admin_password']    ?? '',
        })
        setCredsLoading(false)
      })
  }, [])

  // ── PIN change helpers ────────────────────────────────────────────────────

  function startPinChange(role: RoleKey) {
    setPinState({ role, pin: '', pinConfirm: '', error: null, saving: false })
    setView('pin-enter')
    setSuccess(null)
  }

  function handlePinDigit(digit: string) {
    const isConfirm = view === 'pin-confirm'
    const current = isConfirm ? pinState.pinConfirm : pinState.pin
    if (current.length >= 6) return
    const next = current + digit
    setPinState(s => ({ ...s, error: null, ...(isConfirm ? { pinConfirm: next } : { pin: next }) }))
  }

  function handlePinBackspace() {
    const isConfirm = view === 'pin-confirm'
    setPinState(s => ({ ...s, error: null, ...(isConfirm ? { pinConfirm: s.pinConfirm.slice(0, -1) } : { pin: s.pin.slice(0, -1) }) }))
  }

  async function handlePinNext() {
    if (view === 'pin-enter') {
      if (pinState.pin.length < 6) return
      setPinState(s => ({ ...s, pinConfirm: '', error: null }))
      setView('pin-confirm')
      return
    }
    if (pinState.pin !== pinState.pinConfirm) {
      setPinState(s => ({ ...s, error: 'PINs stimmen nicht überein', pinConfirm: '' }))
      return
    }
    if (!pinState.role) return
    setPinState(s => ({ ...s, saving: true }))
    const hash = await hashPin(pinState.pin)
    const key = pinState.role === 'employee' ? 'employee_pin_hash' : 'admin_pin_hash'
    const { error } = await supabase.from('settings').update({ value: hash }).eq('key', key)
    setPinState(s => ({ ...s, saving: false }))
    if (error) { setPinState(s => ({ ...s, error: error.message })); return }
    showSuccess(`${ROLE_LABEL[pinState.role!]}-PIN gespeichert`)
    setView('overview')
  }

  // ── Credential edit helpers ───────────────────────────────────────────────

  function startCredEdit(role: RoleKey) {
    setCredEdit({
      role,
      email:    role === 'employee' ? creds.employee_email    : creds.admin_email,
      password: role === 'employee' ? creds.employee_password : creds.admin_password,
      saving: false,
      error: null,
    })
    setView('cred-edit')
    setSuccess(null)
  }

  async function handleCredSave() {
    if (!credEdit) return
    setCredEdit(s => s && ({ ...s, saving: true }))
    const emailKey    = credEdit.role === 'employee' ? 'employee_email'    : 'admin_email'
    const passwordKey = credEdit.role === 'employee' ? 'employee_password' : 'admin_password'
    const [r1, r2] = await Promise.all([
      supabase.from('settings').upsert({ key: emailKey,    value: credEdit.email    }).eq('key', emailKey),
      supabase.from('settings').upsert({ key: passwordKey, value: credEdit.password }).eq('key', passwordKey),
    ])
    const err = r1.error ?? r2.error
    if (err) { setCredEdit(s => s && ({ ...s, saving: false, error: err.message })); return }
    setCreds(c => ({
      ...c,
      [emailKey]:    credEdit.email,
      [passwordKey]: credEdit.password,
    }))
    showSuccess(`${ROLE_LABEL[credEdit.role]}-Zugangsdaten gespeichert`)
    setCredEdit(null)
    setView('overview')
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  function showSuccess(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  function goBack() {
    setView('overview')
    setPinState({ role: null, pin: '', pinConfirm: '', error: null, saving: false })
    setCredEdit(null)
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isConfirmStep = view === 'pin-confirm'
  const activePin = isConfirmStep ? pinState.pinConfirm : pinState.pin

  const headerTitle =
    view === 'overview'   ? 'PIN-Verwaltung' :
    view === 'pin-enter'  ? `${ROLE_LABEL[pinState.role!]}-PIN festlegen` :
    view === 'pin-confirm'? `${ROLE_LABEL[pinState.role!]}-PIN bestätigen` :
    view === 'cred-edit'  ? `${ROLE_LABEL[credEdit!.role]}-Zugangsdaten` :
    'PIN-Verwaltung'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            {view !== 'overview' && (
              <button onClick={goBack} className="text-slate-400 hover:text-slate-600 transition-colors mr-1">←</button>
            )}
            <KeyRound size={16} className="text-slate-500" />
            <h2 className="font-semibold text-slate-800">{headerTitle}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* ── Overview ── */}
        {view === 'overview' && (
          <div className="overflow-y-auto p-5 space-y-5">
            {success && (
              <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>
            )}

            {/* PINs section */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">PINs</p>
              <div className="space-y-2">
                {(['employee', 'admin'] as RoleKey[]).map(role => (
                  <div key={role} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{ROLE_LABEL[role]}-PIN</p>
                      <p className="text-xs text-slate-400 mt-0.5">6-stellige PIN</p>
                    </div>
                    <button
                      onClick={() => startPinChange(role)}
                      className="text-sm text-sky-600 hover:text-sky-700 font-medium transition-colors"
                    >
                      Ändern
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Credentials section */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Zugangsdaten</p>
              {credsLoading ? (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {(['employee', 'admin'] as RoleKey[]).map(role => {
                    const email = role === 'employee' ? creds.employee_email : creds.admin_email
                    const pw    = role === 'employee' ? creds.employee_password : creds.admin_password
                    return (
                      <div key={role} className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-slate-800">{ROLE_LABEL[role]}-Konto</p>
                          <button
                            onClick={() => startCredEdit(role)}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1"
                            title="Bearbeiten"
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-400">E-Mail</p>
                          <p className="text-sm text-slate-700 font-mono break-all">{email || '—'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-400">Passwort</p>
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-slate-700 font-mono flex-1">
                              {pw ? (showPw[role] ? pw : '••••••••') : '—'}
                            </p>
                            {pw && (
                              <button
                                onClick={() => setShowPw(s => ({ ...s, [role]: !s[role] }))}
                                className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                                title={showPw[role] ? 'Verbergen' : 'Anzeigen'}
                              >
                                {showPw[role] ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-2">
                Diese Daten werden nur hier gespeichert und sind ausschließlich für Admins sichtbar.
              </p>
            </div>
          </div>
        )}

        {/* ── PIN entry / confirm ── */}
        {(view === 'pin-enter' || view === 'pin-confirm') && (
          <div className="p-5 flex flex-col items-center gap-5">
            <p className="text-sm text-slate-500">
              {isConfirmStep ? 'PIN erneut eingeben zur Bestätigung' : 'Neuen 6-stelligen PIN eingeben'}
            </p>
            <div className="flex gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full transition-all duration-150 ${i < activePin.length ? 'bg-sky-500 scale-110' : 'bg-slate-200'}`} />
              ))}
            </div>
            {pinState.error && <p className="text-red-500 text-sm -mt-2">{pinState.error}</p>}
            <div className="grid grid-cols-3 gap-3 w-full">
              {NUMPAD_KEYS.map((key, i) =>
                key === '' ? <div key={i} /> :
                key === '⌫' ? (
                  <button key={i} onClick={handlePinBackspace}
                    className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 text-lg font-medium transition-all flex items-center justify-center">
                    ⌫
                  </button>
                ) : (
                  <button key={i} onClick={() => handlePinDigit(key)}
                    className="py-3 rounded-2xl bg-slate-50 hover:bg-sky-50 hover:text-sky-700 active:scale-95 text-slate-800 text-lg font-semibold transition-all border border-slate-200 hover:border-sky-200">
                    {key}
                  </button>
                )
              )}
            </div>
            <button onClick={handlePinNext} disabled={activePin.length < 6 || pinState.saving}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
              {pinState.saving ? 'Speichern…' : isConfirmStep ? 'Bestätigen & Speichern' : 'Weiter'}
            </button>
          </div>
        )}

        {/* ── Credential edit ── */}
        {view === 'cred-edit' && credEdit && (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">E-Mail</label>
              <input
                type="email"
                value={credEdit.email}
                onChange={e => setCredEdit(s => s && ({ ...s, email: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                placeholder="z.B. admin@dentalorder.app"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Passwort</label>
              <div className="relative">
                <input
                  type={showPw[credEdit.role] ? 'text' : 'password'}
                  value={credEdit.password}
                  onChange={e => setCredEdit(s => s && ({ ...s, password: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  placeholder="Passwort eingeben"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => ({ ...s, [credEdit.role]: !s[credEdit.role] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPw[credEdit.role] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {credEdit.error && (
              <p className="text-red-500 text-sm">{credEdit.error}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={goBack}
                className="flex-1 border border-slate-300 rounded-xl py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={handleCredSave} disabled={!credEdit.email.trim() || !credEdit.password.trim() || credEdit.saving}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors">
                {credEdit.saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
