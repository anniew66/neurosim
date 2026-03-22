// components/panels/LeftSidebar.jsx
// Tabs: Brush | Surface | Presets

import { useState } from 'react'
import BrushPanel   from '../ui/BrushPanel.jsx'
import SurfacePanel from '../ui/SurfacePanel.jsx'
import PresetPanel  from '../ui/PresetPanel.jsx'

const TABS = [
  { id: 'brush',   label: 'Brush'   },
  { id: 'surface', label: 'Surface' },
  { id: 'presets', label: 'Presets' },
]

export default function LeftSidebar() {
  const [tab, setTab] = useState('brush')

  return (
    <aside className="sidebar-left">
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 0', background: 'none', border: 'none',
            borderBottom: tab === t.id ? '2px solid var(--accent-axon)' : '2px solid transparent',
            color: tab === t.id ? 'var(--text-primary)' : 'var(--text-dim)',
            fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.04em',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'brush'   && <BrushPanel />}
        {tab === 'surface' && <SurfacePanel />}
        {tab === 'presets' && <PresetPanel />}
      </div>
    </aside>
  )
}
