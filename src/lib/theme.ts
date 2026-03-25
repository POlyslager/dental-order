// Three modes: 'light' | 'dark' | 'system'
// 'system' follows OS prefers-color-scheme
export type ThemeMode = 'light' | 'dark' | 'system'

export function getStoredTheme(): ThemeMode {
  try { return (localStorage.getItem('theme') as ThemeMode) || 'system' } catch { return 'system' }
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'dark') {
    root.classList.add('dark')
  } else if (mode === 'light') {
    root.classList.remove('dark')
  } else {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)
  }
  try { localStorage.setItem('theme', mode) } catch {}
}

export function initTheme() {
  applyTheme(getStoredTheme())
}
