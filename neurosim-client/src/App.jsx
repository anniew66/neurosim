// App.jsx
import { Suspense } from 'react'
import Toolbar      from './components/ui/Toolbar.jsx'
import LeftSidebar  from './components/panels/LeftSidebar.jsx'
import RightSidebar from './components/panels/RightSidebar.jsx'
import SceneCanvas  from './components/canvas/SceneCanvas.jsx'
import CanvasHUD    from './components/canvas/CanvasHUD.jsx'

function CanvasLoader() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--bg-base)',
                  color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                  fontSize: 12, letterSpacing: '0.1em' }}>
      initialising renderer…
    </div>
  )
}

export default function App() {
  return (
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
  )
}
