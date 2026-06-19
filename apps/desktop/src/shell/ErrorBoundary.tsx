import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from './diag'

interface Props {
  scope: 'feature' | 'root'
  featureId?: string
  title?: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Fault isolation primitive.
 * - scope="root": fatal full-screen fallback. Core feature crashes bubble here.
 * - scope="feature": inline gray card; the rest of the app keeps running.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError({
      scope: this.props.scope,
      featureId: this.props.featureId,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    })
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.scope === 'root') {
      return (
        <div role="alert" className="ccui-fatal">
          <h1>CCui 崩溃了</h1>
          <p>核心模块出错,应用已停止。错误已记录到诊断日志。</p>
          <pre>{error.message}</pre>
          <button type="button" onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      )
    }

    return (
      <div role="alert" className="ccui-feature-error">
        <strong>{this.props.title ?? this.props.featureId ?? '此模块'} 出错</strong>
        <p>{error.message}</p>
        <button type="button" onClick={this.reset}>
          重试
        </button>
      </div>
    )
  }
}
