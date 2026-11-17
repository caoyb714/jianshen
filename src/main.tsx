import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log health data. */
  }
  render() {
    // 不复用 EmptyState：错误边界在 Router 之外，不能用 <Link>，也不该依赖应用内组件；
    // 这里的按钮是原生 button（重新加载整页），与 EmptyState 的 h3 结构也不一致
    return this.state.failed ? (
      <div className="empty-state">
        <h1>页面暂时没有打开</h1>
        <p>请重新加载；本机已保存的记录不会因此删除。</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    )
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
