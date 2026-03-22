// components/ui/SimControls.jsx
// Right sidebar bottom section: global simulation parameters + result summary.

import useSimStore   from '../../store/useSimStore.js'
import useSceneStore  from '../../store/useSceneStore.js'
import useRegionStore from '../../store/useRegionStore.js'

function ParamRow({ label, paramKey, type = 'number', step, min, max }) {
  const value       = useSimStore(s => s.params[paramKey])
  const updateParam = useSimStore(s => s.updateParam)
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="ns-label">{label}</div>
      <input
        className="ns-input"
        type={type}
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={e => updateParam(paramKey, type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </div>
  )
}

function ResultCard({ result }) {
  if (!result) return null
  const rows = [
    ['Neurons simulated', result.n_neurons],
    ['Neurites',          result.total_neurites],
    ['Axons',             result.n_axons],
    ['Synapses formed',   result.synapses_formed],
    ['VTK output',        result.vtk_dir?.split(/[\\/]/).pop() ?? '—'],
  ]
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--accent-chem)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      marginTop: 12,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-chem)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        Last Result
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{v ?? '—'}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        Open ParaView → load_in_paraview.py
      </div>
    </div>
  )
}

function ErrorCard({ error }) {
  if (!error) return null
  return (
    <div style={{
      background: 'rgba(229,57,53,0.08)',
      border: '1px solid var(--accent-dend)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      marginTop: 12,
      fontSize: 11,
      color: 'var(--accent-dend)',
      lineHeight: 1.5,
    }}>
      {error}
    </div>
  )
}

export default function SimControls() {
  const status  = useSimStore(s => s.status)
  const result  = useSimStore(s => s.result)
  const error   = useSimStore(s => s.error)
  const run     = useSimStore(s => s.run)
  const reset   = useSimStore(s => s.reset)
  const neurons    = useSceneStore(s => s.neurons)
  const chems      = useSceneStore(s => s.chemicals)
  const regions    = useRegionStore(s => s.regions)
  const bulkCount  = useRegionStore(s => s.totalCount())

  return (
    <div className="panel-scroll">
      {/* Scene summary */}
      <div className="panel-section">
        <div className="panel-label">Scene</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['Neurons',   neurons.length],
            ['Chemicals', chems.length],
            ['Neurites',  neurons.reduce((s, n) => s + n.neurites.length, 0)],
            ['Axons',     neurons.filter(n => n.neurites.length > 0).length],
          ].map(([k, v]) => (
            <div key={k} style={{
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              border: '1px solid var(--border-dim)',
            }}>
              <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', color: 'var(--text-accent)', fontWeight: 500 }}>{v}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sim params */}
      <div className="panel-section">
        <div className="panel-label">Simulation Parameters</div>

        <div className="ns-input-row">
          <div>
            <div className="ns-label">Max steps</div>
            <input className="ns-input" type="number" step={100} min={100}
              value={useSimStore(s => s.params.max_steps)}
              onChange={e => useSimStore.getState().updateParam('max_steps', Number(e.target.value))} />
          </div>
          <div>
            <div className="ns-label">Seed</div>
            <input className="ns-input" type="number" step={1} min={1}
              value={useSimStore(s => s.params.seed)}
              onChange={e => useSimStore.getState().updateParam('seed', Number(e.target.value))} />
          </div>
        </div>

        <div className="ns-input-row">
          <div>
            <div className="ns-label">Chemotaxis α</div>
            <input className="ns-input" type="number" step={0.1} min={0}
              value={useSimStore(s => s.params.chemotaxis)}
              onChange={e => useSimStore.getState().updateParam('chemotaxis', Number(e.target.value))} />
          </div>
          <div>
            <div className="ns-label">Random walk β</div>
            <input className="ns-input" type="number" step={0.05} min={0}
              value={useSimStore(s => s.params.random_walk)}
              onChange={e => useSimStore.getState().updateParam('random_walk', Number(e.target.value))} />
          </div>
        </div>

        <div className="ns-input-row">
          <div>
            <div className="ns-label">Synapse radius</div>
            <input className="ns-input" type="number" step={0.5} min={0.5}
              value={useSimStore(s => s.params.synapse_radius)}
              onChange={e => useSimStore.getState().updateParam('synapse_radius', Number(e.target.value))} />
          </div>
          <div>
            <div className="ns-label">Step size</div>
            <input className="ns-input" type="number" step={0.1} min={0.1}
              value={useSimStore(s => s.params.step_size)}
              onChange={e => useSimStore.getState().updateParam('step_size', Number(e.target.value))} />
          </div>
        </div>

        <div>
          <div className="ns-label">Extent (box side, u)</div>
          <input className="ns-input" type="number" step={10} min={10}
            value={useSimStore(s => s.params.extent)}
            onChange={e => useSimStore.getState().updateParam('extent', Number(e.target.value))} />
        </div>
      </div>

      {/* Run button */}
      <div className="panel-section">
        <button
          className="ns-btn primary"
          style={{ width: '100%', padding: '10px', fontSize: 13 }}
          disabled={status === 'running' || (neurons.length === 0 && bulkCount === 0)}
          onClick={run}
        >
          {status === 'running' ? '⟳  Simulating…' : '▶  Run Simulation'}
        </button>

        {(status === 'done' || status === 'error') && (
          <button className="ns-btn" style={{ width: '100%', marginTop: 6 }} onClick={reset}>
            Reset Status
          </button>
        )}

        <ResultCard result={result} />
        <ErrorCard  error={error} />
      </div>
    </div>
  )
}
