import { Component } from 'react'
import type { ReactNode } from 'react'

interface State { hasError: boolean }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // ChunkLoadError = stale JS chunks after a new deploy → hard reload fixes it
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('ChunkLoadError')) {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-900 p-8 text-center">
          <p className="text-slate-600 dark:text-slate-300 text-sm font-medium">Etwas ist schiefgelaufen.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
