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
      <div className="tab-strip">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>
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
