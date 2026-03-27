import { useEffect, useState, useCallback } from 'react'
import { useIsDesktop } from '../hooks/useIsDesktop'
import { KeyRound, Eye, EyeOff, Pencil, ChevronRight, X, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { hashPin } from '../lib/pin'

type RoleKey = 'employee' | 'admin'
type Panel = null | 'pin-enter' | 'pin-confirm' | 'cred-edit'

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

export default function PinSettingsModal({ onClose: _onClose }: Props) {
  const isDesktop = useIsDesktop()
  const [panel, setPanel] = useState<Panel>(null)
  const [closing, setClosing] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const [pinState, setPinState] = useState<PinState>({ role: null, pin: '', pinConfirm: '', error: null, saving: false })

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

  const closePanel = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setPanel(null)
      setClosing(false)
      setPinState({ role: null, pin: '', pinConfirm: '', error: null, saving: false })
      setCredEdit(null)
    }, 260)
  }, [])

  // ── PIN helpers ───────────────────────────────────────────────────────────

  function openPinChange(role: RoleKey) {
    setPinState({ role, pin: '', pinConfirm: '', error: null, saving: false })
    setPanel('pin-enter')
    setClosing(false)
  }

  function handlePinDigit(digit: string) {
    const isConfirm = panel === 'pin-confirm'
    const current = isConfirm ? pinState.pinConfirm : pinState.pin
    if (current.length >= 6) return
    setPinState(s => ({ ...s, error: null, ...(isConfirm ? { pinConfirm: current + digit } : { pin: current + digit }) }))
  }

  function handlePinBackspace() {
    const isConfirm = panel === 'pin-confirm'
    setPinState(s => ({ ...s, error: null, ...(isConfirm ? { pinConfirm: s.pinConfirm.slice(0, -1) } : { pin: s.pin.slice(0, -1) }) }))
  }

  async function handlePinNext() {
    if (panel === 'pin-enter') {
      if (pinState.pin.length < 6) return
      setPinState(s => ({ ...s, pinConfirm: '', error: null }))
      setPanel('pin-confirm')
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
    closePanel()
  }

  // ── Credential helpers ────────────────────────────────────────────────────

  function openCredEdit(role: RoleKey) {
    setCredEdit({
      role,
      email:    role === 'employee' ? creds.employee_email    : creds.admin_email,
      password: role === 'employee' ? creds.employee_password : creds.admin_password,
      saving: false,
      error: null,
    })
    setPanel('cred-edit')
    setClosing(false)
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
    setCreds(c => ({ ...c, [emailKey]: credEdit.email, [passwordKey]: credEdit.password }))
    showSuccess(`${ROLE_LABEL[credEdit.role]}-Zugangsdaten gespeichert`)
    closePanel()
  }

  function showSuccess(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const isConfirmStep = panel === 'pin-confirm'
  const activePin = isConfirmStep ? pinState.pinConfirm : pinState.pin

  const panelTitle =
    panel === 'pin-enter'   ? `${ROLE_LABEL[pinState.role!]}-PIN festlegen` :
    panel === 'pin-confirm' ? `${ROLE_LABEL[pinState.role!]}-PIN bestätigen` :
    panel === 'cred-edit'   ? `${ROLE_LABEL[credEdit!.role]}-Zugangsdaten` : ''

  return (
    <div className={`flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900 ${isDesktop ? 'pb-0' : 'pb-20'}`}>
      <div className="max-w-xl mx-auto p-4 lg:p-6 space-y-6">

        {success && (
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-sm text-emerald-700 dark:text-emerald-400">
            <Check size={15} className="shrink-0" />
            {success}
          </div>
        )}

        {/* PINs card */}
        <div>
          <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">PINs</h2>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-50 dark:divide-slate-700">
            {(['employee', 'admin'] as RoleKey[]).map(role => (
              <button
                key={role}
                onClick={() => openPinChange(role)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <KeyRound size={18} className="text-sky-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{ROLE_LABEL[role]}-PIN</p>
                  <p className="text-xs text-slate-400">6-stellige PIN ändern</p>
                </div>
                <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Zugangsdaten card */}
        <div>
          <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Zugangsdaten</h2>
          {credsLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-50 dark:divide-slate-700">
              {(['employee', 'admin'] as RoleKey[]).map(role => {
                const email = role === 'employee' ? creds.employee_email : creds.admin_email
                const pw    = role === 'employee' ? creds.employee_password : creds.admin_password
                return (
                  <div key={role} className="px-5 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{ROLE_LABEL[role]}-Konto</p>
                      <button
                        onClick={() => openCredEdit(role)}
                        className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium transition-colors"
                      >
                        <Pencil size={12} />
                        Bearbeiten
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-slate-400 mb-0.5">E-Mail</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 font-mono truncate">{email || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-0.5">Passwort</p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm text-slate-700 dark:text-slate-300 font-mono flex-1">
                            {pw ? (showPw[role] ? pw : '••••••••') : '—'}
                          </p>
                          {pw && (
                            <button
                              onClick={() => setShowPw(s => ({ ...s, [role]: !s[role] }))}
                              className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors shrink-0"
                            >
                              {showPw[role] ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2 px-1">
            Diese Daten sind ausschließlich für Admins sichtbar.
          </p>
        </div>

      </div>

      {/* ── Slide-in panel ── */}
      {panel && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[59] animate-fade-in" onClick={closePanel} />
          <div className={`fixed inset-0 bg-white dark:bg-slate-800 z-[60] flex flex-col md:inset-auto md:top-0 md:bottom-0 md:right-0 md:w-[420px] md:shadow-2xl overflow-hidden ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>

            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-slate-500 dark:text-slate-400" />
                <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{panelTitle}</h2>
              </div>
              <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-1 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* PIN entry / confirm */}
            {(panel === 'pin-enter' || panel === 'pin-confirm') && (
              <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-5">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {isConfirmStep ? 'PIN erneut eingeben zur Bestätigung' : 'Neuen 6-stelligen PIN eingeben'}
                </p>
                <div className="flex gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={`w-3 h-3 rounded-full transition-all duration-150 ${i < activePin.length ? 'bg-sky-500 scale-110' : 'bg-slate-200 dark:bg-slate-600'}`} />
                  ))}
                </div>
                {pinState.error && <p className="text-red-500 text-sm -mt-2">{pinState.error}</p>}
                <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                  {NUMPAD_KEYS.map((key, i) =>
                    key === '' ? <div key={i} /> :
                    key === '⌫' ? (
                      <button key={i} onClick={handlePinBackspace}
                        className="py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 text-slate-600 dark:text-slate-300 text-lg font-medium transition-all flex items-center justify-center">
                        ⌫
                      </button>
                    ) : (
                      <button key={i} onClick={() => handlePinDigit(key)}
                        className="py-3 rounded-2xl bg-slate-50 dark:bg-slate-700 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:text-sky-700 dark:hover:text-sky-300 active:scale-95 text-slate-800 dark:text-slate-100 text-lg font-semibold transition-all border border-slate-200 dark:border-slate-600 hover:border-sky-200 dark:hover:border-sky-700">
                        {key}
                      </button>
                    )
                  )}
                </div>
                <button
                  onClick={handlePinNext}
                  disabled={activePin.length < 6 || pinState.saving}
                  className="w-full max-w-xs bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors"
                >
                  {pinState.saving ? 'Speichern…' : isConfirmStep ? 'Bestätigen & Speichern' : 'Weiter'}
                </button>
              </div>
            )}

            {/* Credential edit */}
            {panel === 'cred-edit' && credEdit && (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">E-Mail</label>
                  <input
                    type="email"
                    value={credEdit.email}
                    onChange={e => setCredEdit(s => s && ({ ...s, email: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 font-mono dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
                    placeholder="z.B. admin@dentalorder.app"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Passwort</label>
                  <div className="relative">
                    <input
                      type={showPw[credEdit.role] ? 'text' : 'password'}
                      value={credEdit.password}
                      onChange={e => setCredEdit(s => s && ({ ...s, password: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 font-mono dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
                      placeholder="Passwort eingeben"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(s => ({ ...s, [credEdit.role]: !s[credEdit.role] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                    >
                      {showPw[credEdit.role] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                {credEdit.error && <p className="text-red-500 text-sm">{credEdit.error}</p>}
                <div className="flex gap-3 pt-1">
                  <button onClick={closePanel}
                    className="flex-1 border border-slate-200 dark:border-slate-600 rounded-xl py-3 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    Abbrechen
                  </button>
                  <button
                    onClick={handleCredSave}
                    disabled={!credEdit.email.trim() || !credEdit.password.trim() || credEdit.saving}
                    className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors"
                  >
                    {credEdit.saving ? 'Speichern…' : 'Speichern'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </>
      )}
    </div>
  )
}
