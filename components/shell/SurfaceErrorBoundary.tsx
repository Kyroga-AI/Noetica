'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Human label for the surface, shown in the fallback. */
  surface?: string
}

interface State {
  error: Error | null
  info: string
}

// Per-surface error boundary. Without this, a render-time throw in any one surface
// unmounts the entire React tree — the whole app goes blank and looks "busted" when
// only one panel is broken. This catches the crash, keeps the shell + navigation alive
// so the user can switch away, and shows the actual error message on screen (no devtools
// needed in packaged builds). Reset it by giving it a `key` that changes per surface.
export class SurfaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): State {
    return { error, info: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the stack to the console too, for when devtools IS available (dev / nightly).
    console.error(`[surface-crash]${this.props.surface ? ` ${this.props.surface}:` : ''}`, error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto p-6">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">
          This panel hit an error{this.props.surface ? ` (${this.props.surface})` : ''}.
        </div>
        <div className="text-xs text-[var(--color-text-secondary)]">
          The rest of the app still works — switch to another surface from the rail. Details below:
        </div>
        <pre className="max-w-full overflow-auto rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[11px] text-[#dc2626]">
          {error.message || String(error)}
        </pre>
        {info && (
          <details className="w-full">
            <summary className="cursor-pointer text-[11px] text-[var(--color-text-tertiary)]">Component stack</summary>
            <pre className="mt-1 max-w-full overflow-auto rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">
              {info.trim()}
            </pre>
          </details>
        )}
        <button
          onClick={() => this.setState({ error: null, info: '' })}
          className="rounded-lg bg-[var(--color-background-secondary)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-background-tertiary)]"
        >
          Try again
        </button>
      </div>
    )
  }
}
