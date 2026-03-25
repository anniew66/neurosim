// components/ui/Toolbar.jsx

import { useEffect } from 'react'
import useBrushStore  from '../../store/useBrushStore.js'
import useSimStore    from '../../store/useSimStore.js'
import useSceneStore  from '../../store/useSceneStore.js'
import useRegionStore   from '../../store/useRegionStore.js'
import useHistoryStore  from '../../store/useHistoryStore.js'


const BRUSHES = [
  { id: 'point',   label: 'Point',   key: 'p', tip: 'Place single precise neuron [P]' },
  { id: 'area',    label: 'Area',    key: 'a', tip: 'Paint bulk neuron region [A]' },
  { id: 'carve',   label: 'Carve',   key: 'c', tip: 'Erase from bulk region [C]' },
  { id: 'promote', label: 'Promote', key: 'o', tip: 'Extract bulk → precise [O]' },
  { id: 'erase',   label: 'Erase',   key: 'e', tip: 'Remove precise neurons [E]' },
  { id: 'select',  label: 'Select',  key: 's', tip: 'Select neuron or region [S]' },
  { id: 'density',  label: 'Density', key: 'd', tip: 'Paint tissue density field [D]' },
]

function StatusBadge() {
  const status = useSimStore(s => s.status)
  const result = useSimStore(s => s.result)
  const error  = useSimStore(s => s.error)

  const label =
    status === 'running' ? 'Simulating…' :
    status === 'done'    ? `Complete — ${result?.synapses_formed ?? 0} synapses` :
    status === 'error'   ? 'Error' : 'Ready'

  return (
    <div className={`sim-status ${status}`} title={error ?? ''}>
      <div className="dot" />
      {label}
    </div>
  )
}

function ServerLight() {
  const online = useSimStore(s => s.serverOnline)
  const ping   = useSimStore(s => s.ping)
  useEffect(() => { ping() }, [])

  const color = online === null ? 'var(--text-disabled)' :
                online             ? 'var(--accent-green)' :
                                     'var(--accent-red)'
  const label = online === null ? 'Checking…' :
                online             ? 'Server online' : 'Server offline'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                  fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
                  paddingRight: 8, borderRight: '1px solid var(--border-mid)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color,
                     display: 'inline-block', flexShrink: 0 }} />
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
  const bulkCount    = useRegionStore(s => s.totalCount())
  const hasAnything  = preciseCount > 0 || bulkCount > 0

  const undo          = useHistoryStore(s => s.undo)
  const canUndo       = useHistoryStore(s => s.canUndo)
  const clearHistory  = useHistoryStore(s => s.clear)
  const clearPrecise  = useSceneStore(s => s.clearScene)
  const clearRegions = useRegionStore(s => s.clearAll)

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      // Ctrl+Z or Cmd+Z — undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        useHistoryStore.getState().undo()
        return
      }
      const b = BRUSHES.find(b => b.key === e.key.toLowerCase())
      if (b) setMode(b.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  return (
    <div className="app-toolbar">
      {/* Logo */}
      <div className="logo">Neuro<span>Sim</span></div>

      {/* Brush pills */}
      <div style={{ display: 'flex', gap: 2 }}>
        {BRUSHES.map(b => (
          <button
            key={b.id}
            className={`brush-pill ${mode === b.id ? 'active' : ''}`}
            data-tooltip={b.tip}
            onClick={() => setMode(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Neuron counts */}
      {hasAnything && (
        <div style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: 'var(--text-dim)',
          display: 'flex', gap: 10, alignItems: 'center',
          paddingRight: 10, borderRight: '1px solid var(--border-mid)',
        }}>
          <span>
            precise&nbsp;
            <span style={{ color: 'var(--text-secondary)' }}>{preciseCount}</span>
          </span>
          <span>
            bulk&nbsp;
            <span style={{ color: 'var(--text-secondary)' }}>
              {bulkCount.toLocaleString()}
            </span>
          </span>
        </div>
      )}

      <ServerLight />
      <StatusBadge />

      <button className="ns-btn"
        onClick={undo}
        disabled={!canUndo}
        data-tooltip="Undo last stroke [Ctrl+Z]"
        style={{ marginLeft: 4, fontFamily: 'var(--font-mono)' }}>
        ↩ Undo
      </button>

      <button className="ns-btn"
        onClick={() => {
          // Snapshot for undo before wiping
          const neurons   = useSceneStore.getState().exportSnapshot?.() ?? { neurons: [], chemicals: [] }
          const regions   = useRegionStore.getState().exportSnapshot?.() ?? []
          useHistoryStore.getState().push({
            type: 'CLEAR',
            neurons: neurons.neurons ?? [],
            chemicals: neurons.chemicals ?? [],
            regions,
          })
          clearPrecise()
          clearRegions()
          clearHistory()
        }}
        disabled={!hasAnything}
        style={{ marginLeft: 2 }}>
        Clear
      </button>

      <button className="ns-btn primary"
        onClick={run}
        disabled={status === 'running' || !hasAnything}
        style={{ marginLeft: 4 }}>
        {status === 'running' ? 'Running…' : '▶  Run'}
      </button>
    </div>
  )
}
