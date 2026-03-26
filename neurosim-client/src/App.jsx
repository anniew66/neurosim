// App.jsx
import { Suspense, Component } from 'react'
import Toolbar      from './components/ui/Toolbar.jsx'
import LeftSidebar  from './components/panels/LeftSidebar.jsx'
import RightSidebar from './components/panels/RightSidebar.jsx'
import SceneCanvas  from './components/canvas/SceneCanvas.jsx'
import CanvasHUD    from './components/canvas/CanvasHUD.jsx'

// Error boundary — catches render errors and shows them on-screen
// instead of a silent black screen. Remove after debugging.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#1c1c1c',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 16, padding: 32,
          fontFamily: 'monospace', color: '#f0f0f0',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#c0392b' }}>
            Render Error
          </div>
          <div style={{
            background: '#242424', border: '1px solid #505050',
            borderRadius: 4, padding: 16, maxWidth: 800, width: '100%',
            fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            color: '#ef9a9a', overflowY: 'auto', maxHeight: '60vh',
          }}>
            {String(this.state.error)}
            {'\n\n'}
            {this.state.error?.stack}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              background: '#2b6cb0', border: 'none', borderRadius: 4,
              color: '#fff', padding: '8px 20px', cursor: 'pointer',
              fontSize: 13,
            }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function CanvasLoader() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-base)', color: 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  letterSpacing: '0.1em' }}>
      initialising renderer…
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app-shell">
        <Toolbar />
        <LeftSidebar />
        <main className="canvas-area">
          <Suspense fallback={<CanvasLoader />}>
            <SceneCanvas />
          </Suspense>
          <CanvasHUD />
        </main>
        <RightSidebar />
      </div>
    </ErrorBoundary>
  )
}
