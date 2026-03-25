// components/panels/RightSidebar.jsx
// Tabs: Inspector (neuron or region) | Simulate

import { useState, useEffect } from 'react'
import NeuronInspector from '../ui/NeuronInspector.jsx'
import RegionInspector from '../ui/RegionInspector.jsx'
import SimControls     from '../ui/SimControls.jsx'
import useSceneStore   from '../../store/useSceneStore.js'
import useRegionStore  from '../../store/useRegionStore.js'

const TABS = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'simulate',  label: 'Simulate'  },
]

export default function RightSidebar() {
  const [tab, setTab]       = useState('inspector')
  const selectedNeuronId    = useSceneStore(s => s.selectedNeuronId)
  const selectedRegionId    = useRegionStore(s => s.selectedRegionId)
  const hasSelection        = selectedNeuronId || selectedRegionId

  // Which inspector to show
  const showNeuron = selectedNeuronId && !selectedRegionId
  const showRegion = !!selectedRegionId

  return (
    <aside className="sidebar-right">
      <div className="tab-strip">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'inspector' && hasSelection && (
              <span style={{ display: 'inline-block', width: 5, height: 5,
                             borderRadius: '50%', background: 'var(--accent-amber)',
                             marginLeft: 5, verticalAlign: 'middle' }} />
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'inspector' && (
          <>
            {showRegion  && <RegionInspector />}
            {showNeuron  && <NeuronInspector />}
            {!hasSelection && (
              <div className="panel-section" style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ marginBottom: 8, color: 'var(--text-secondary)', fontWeight: 600 }}>Inspector</div>
                Switch to <strong style={{ color: 'var(--accent-warn)' }}>Select [S]</strong> mode,
                then click:
                <ul style={{ marginTop: 6, paddingLeft: 14, lineHeight: 2 }}>
                  <li>A <span style={{ color: 'var(--accent-chem)' }}>painted region</span> to edit all neurons in it</li>
                  <li>A <span style={{ color: 'var(--text-accent)' }}>precise neuron</span> to edit individually</li>
                </ul>
              </div>
            )}
          </>
        )}
        {tab === 'simulate' && <SimControls />}
      </div>
    </aside>
  )
}
