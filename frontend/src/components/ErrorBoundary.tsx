import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught:', error, info.componentStack)
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center px-4">
          <span className="text-2xl">⚠</span>
          <span className="text-sm text-amber-400 font-mono">Something crashed here — the rest of the page is unaffected.</span>
          <button onClick={this.reset} className="btn-ghost text-xs border border-navy-600">
            Retry
          </button>
        </div>
      </div>
    )
  }
}
