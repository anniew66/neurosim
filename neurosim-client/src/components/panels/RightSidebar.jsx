// components/panels/RightSidebar.jsx

import { useState, useEffect, useRef, useCallback } from 'react'
import NeuronInspector from '../ui/NeuronInspector.jsx'
import RegionInspector from '../ui/RegionInspector.jsx'
import SimControls     from '../ui/SimControls.jsx'
import SimViewer       from '../canvas/SimViewer.jsx'
import useSceneStore   from '../../store/useSceneStore.js'
import useRegionStore  from '../../store/useRegionStore.js'

const TABS = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'simulate',  label: 'Simulate'  },
  { id: 'viewer',    label: 'Viewer'    },
]

const MIN_W = 220   // px
const MAX_W = 800   // px
const DEFAULT_W = 268

export default function RightSidebar() {
  const [tab, setTab]     = useState('inspector')
  const [width, setWidth] = useState(DEFAULT_W)
  const dragging          = useRef(false)
  const startX            = useRef(0)
  const startW            = useRef(DEFAULT_W)

  const selectedNeuronId = useSceneStore(s => s.selectedNeuronId)
  const selectedRegionId = useRegionStore(s => s.selectedRegionId)
  const hasSelection     = selectedNeuronId || selectedRegionId
  const showNeuron       = !!selectedNeuronId
  const showRegion       = !!selectedRegionId

  // ── Drag-to-resize ────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = width
    document.body.style.cursor    = 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX   // dragging left = wider
      const next  = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current              = false
      document.body.style.cursor    = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  return (
    <aside className="sidebar-right" style={{
        width,
        minWidth: width,
        maxWidth: width,
        flexShrink: 0,
        overflow: 'hidden',
      }}>

      {/* Drag handle on the left edge */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 4, cursor: 'ew-resize', zIndex: 10,
          background: 'transparent',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-blue)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      />

      {/* Tab strip */}
      <div className="tab-strip">
        {TABS.map(t => (
          <button key={t.id}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'inspector' && hasSelection && (
              <span style={{
                display: 'inline-block', width: 5, height: 5,
                borderRadius: '50%', background: 'var(--accent-amber)',
                marginLeft: 5, verticalAlign: 'middle',
              }} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {tab === 'inspector' && (
          <>
            {showRegion  && <RegionInspector />}
            {showNeuron  && <NeuronInspector />}
            {!hasSelection && (
              <div className="panel-section"
                style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ marginBottom: 8, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Inspector
                </div>
                Switch to <strong style={{ color: 'var(--accent-warn)' }}>Select [S]</strong> mode,
                then click:
                <ul style={{ marginTop: 6, paddingLeft: 14, lineHeight: 2 }}>
                  <li>A <span style={{ color: 'var(--accent-chem)' }}>painted region</span></li>
                  <li>A <span style={{ color: 'var(--text-accent)' }}>precise neuron</span></li>
                </ul>
              </div>
            )}
          </>
        )}
        {tab === 'simulate' && <SimControls />}
        {tab === 'viewer'   && <SimViewer />}
      </div>
    </aside>
  )
}
