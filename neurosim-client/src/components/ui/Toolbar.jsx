// components/ui/Toolbar.jsx

import { useEffect } from 'react'
import useBrushStore  from '../../store/useBrushStore.js'
import useSimStore    from '../../store/useSimStore.js'
import useSceneStore  from '../../store/useSceneStore.js'
import useRegionStore from '../../store/useRegionStore.js'

const BRUSHES = [
  { id: 'point',   label: 'Point',   icon: '·',  key: 'p', tip: 'Place single precise neuron' },
  { id: 'area',    label: 'Area',    icon: '⬤',  key: 'a', tip: 'Paint bulk neuron region' },
  { id: 'carve',   label: 'Carve',   icon: '◌',  key: 'c', tip: 'Erase bulk region positions' },
  { id: 'promote', label: 'Promote', icon: '↑',  key: 'o', tip: 'Extract bulk → precise neurons' },
  { id: 'erase',   label: 'Erase',   icon: '✕',  key: 'e', tip: 'Erase precise neurons' },
  { id: 'select',  label: 'Select',  icon: '◎',  key: 's', tip: 'Select neuron or region' },
]

function SimStatusBadge() {
  const status = useSimStore(s => s.status)
  const result = useSimStore(s => s.result)
  const error  = useSimStore(s => s.error)
  const label =
    status === 'running' ? 'Running…' :
    status === 'done'    ? `Done — ${result?.synapses_formed ?? 0} synapses` :
    status === 'error'   ? 'Error' : 'Ready'
  return (
    <div className={`sim-status ${status}`}>
      <div className="dot" />
      {label}
      {status === 'error' && error && (
        <span title={error} style={{ cursor: 'help', marginLeft: 4 }}>(?)</span>
      )}
    </div>
  )
}

function ServerIndicator() {
  const online = useSimStore(s => s.serverOnline)
  const ping   = useSimStore(s => s.ping)
  useEffect(() => { ping() }, [])
  const color = online === null ? '#3d5470' : online ? '#00e5a0' : '#e53935'
  const label = online === null ? 'checking…' : online ? 'server online' : 'server offline'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                  fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </div>
  )
}

export default function Toolbar() {
  const mode    = useBrushStore(s => s.mode)
  const setMode = useBrushStore(s => s.setMode)
  const run     = useSimStore(s => s.run)
  const status  = useSimStore(s => s.status)

  const preciseCount = useSceneStore(s => s.neurons.length)
  const regionCount  = useRegionStore(s => s.regions.length)
  const bulkCount    = useRegionStore(s => s.totalCount())

  const clearPrecise = useSceneStore(s => s.clearScene)
  const clearRegions = useRegionStore(s => s.clearAll)
  const clearAll = () => { clearPrecise(); clearRegions() }

  const totalNeurons = preciseCount + bulkCount
  const hasAnything  = totalNeurons > 0

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      const brush = BRUSHES.find(b => b.key === e.key.toLowerCase())
      if (brush) setMode(brush.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  return (
    <div className="app-toolbar">
      <div className="logo">Neuro<span>Sim</span></div>

      <div style={{ display: 'flex', gap: 3 }}>
        {BRUSHES.map(b => (
          <button
            key={b.id}
            className={`brush-pill ${mode === b.id ? 'active' : ''}`}
            data-brush={b.id}
            data-tooltip={`${b.tip} [${b.key.toUpperCase()}]`}
            onClick={() => setMode(b.id)}
          >
            <span style={{ fontSize: 12 }}>{b.icon}</span>
            {b.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Neuron counts */}
      {hasAnything && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                      display: 'flex', gap: 10, alignItems: 'center' }}>
          <span title="Precise neurons">
            <span style={{ color: 'var(--text-dim)' }}>precise </span>
            <span style={{ color: 'var(--text-accent)' }}>{preciseCount}</span>
          </span>
          <span title="Bulk region neurons">
            <span style={{ color: 'var(--text-dim)' }}>bulk </span>
            <span style={{ color: 'var(--accent-chem)' }}>{bulkCount.toLocaleString()}</span>
          </span>
        </div>
      )}

      <ServerIndicator />
      <SimStatusBadge />

      <button className="ns-btn" onClick={clearAll} disabled={!hasAnything}
        style={{ marginLeft: 8 }}>
        Clear
      </button>

      <button className="ns-btn primary"
        onClick={run}
        disabled={status === 'running' || !hasAnything}
        style={{ marginLeft: 4 }}>
        {status === 'running' ? '⟳ Running…' : '▶ Run Sim'}
      </button>
    </div>
  )
}
