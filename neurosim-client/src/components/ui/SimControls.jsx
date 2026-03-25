// components/ui/SimControls.jsx
// Global simulation parameters + result summary.
// All spatial values in mm. Uses SliderWithInput for logarithmic ranges.

import SliderWithInput from './SliderWithInput.jsx'
import useSimStore    from '../../store/useSimStore.js'
import useSceneStore  from '../../store/useSceneStore.js'
import useRegionStore from '../../store/useRegionStore.js'

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
      background: 'var(--bg-elevated)', border: '1px solid var(--accent-chem)',
      borderRadius: 'var(--radius-md)', padding: '10px 12px', marginTop: 12,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-chem)',
                    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        Last Result
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
                              fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {v ?? '—'}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)' }}>
        Open ParaView → load_in_paraview.py
      </div>
    </div>
  )
}

function ErrorCard({ error }) {
  if (!error) return null
  return (
    <div style={{
      background: 'rgba(229,57,53,0.08)', border: '1px solid var(--accent-dend)',
      borderRadius: 'var(--radius-md)', padding: '10px 12px', marginTop: 12,
      fontSize: 11, color: 'var(--accent-dend)', lineHeight: 1.5,
    }}>
      {error}
    </div>
  )
}

// Param row using SliderWithInput — reads/writes directly from useSimStore
function SimParam({ label, paramKey, min, max, unit, log = false, format }) {
  const value       = useSimStore(s => s.params[paramKey])
  const updateParam = useSimStore(s => s.updateParam)
  return (
    <SliderWithInput label={label} value={value} min={min} max={max}
      unit={unit} log={log} format={format}
      onChange={v => updateParam(paramKey, v)} />
  )
}

export default function SimControls() {
  const status  = useSimStore(s => s.status)
  const result  = useSimStore(s => s.result)
  const error   = useSimStore(s => s.error)
  const run     = useSimStore(s => s.run)
  const reset   = useSimStore(s => s.reset)
  const params  = useSimStore(s => s.params)
  const updateParam = useSimStore(s => s.updateParam)

  const neurons    = useSceneStore(s => s.neurons)
  const chems      = useSceneStore(s => s.chemicals)
  const regions    = useRegionStore(s => s.regions)
  const bulkCount  = useRegionStore(s => s.totalCount())
  const hasAnything = neurons.length > 0 || bulkCount > 0

  return (
    <div className="panel-scroll">
      {/* Scene summary */}
      <div className="panel-section">
        <div className="panel-label">Scene</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            ['Precise', neurons.length],
            ['Bulk',    bulkCount.toLocaleString()],
            ['Regions', regions.length],
            ['Chems',   chems.length],
          ].map(([k, v]) => (
            <div key={k} style={{
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
              padding: '7px 10px', border: '1px solid var(--border-dim)',
            }}>
              <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)',
                            color: 'var(--text-accent)', fontWeight: 500 }}>{v}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Spatial params */}
      <div className="panel-section">
        <div className="panel-label">
          Space
          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 400,
                         marginLeft: 6 }}>mm</span>
        </div>

        {/* Extent: 0.01 mm (10 µm microcolumn) to 180 mm (whole brain) */}
        <SimParam label="Extent (box side)" paramKey="extent"
          min={0.001} max={1000} unit="mm" log />

        {/* Step size: 0.0001 mm (0.1 µm) to 0.1 mm (100 µm) */}
        <SimParam label="Step size" paramKey="step_size"
          min={0.0001} max={0.05} unit="mm" log />

        {/* Synapse radius: 0.0001 mm to 0.1 mm */}
        <SimParam label="Synapse radius" paramKey="synapse_radius"
          min={0.0001} max={0.05} unit="mm" log />
      </div>

      {/* Dynamics */}
      <div className="panel-section">
        <div className="panel-label">Dynamics</div>
        <SimParam label="Chemotaxis α" paramKey="chemotaxis"
          min={0} max={10} unit="×" />
        <SimParam label="Random walk β" paramKey="random_walk"
          min={0} max={3} unit="×" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <div className="ns-label">Max steps</div>
            <input className="ns-input" type="number" step={100} min={100}
              value={params.max_steps}
              onChange={e => updateParam('max_steps', Number(e.target.value))}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
          </div>
          <div>
            <div className="ns-label">Seed</div>
            <input className="ns-input" type="number" step={1} min={1}
              value={params.seed}
              onChange={e => updateParam('seed', Number(e.target.value))}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
          </div>
        </div>
      </div>

      {/* Neuron health */}
      <div className="panel-section">
        <div className="panel-label">Neuron Health &amp; Death</div>
        <SimParam label="Health decay / step" paramKey="health_decay_rate"
          min={0.000001} max={0.01} unit="/step" log
          format={v => v.toExponential(2)} />
        <SimParam label="Death threshold" paramKey="death_threshold"
          min={0.001} max={1} unit="health" />
        <SimParam label="Synapse health boost" paramKey="synapse_health_boost"
          min={0} max={1} unit="" />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 4 }}>
          Neurons decay each step. Synapses boost health. Neurons below the death
          threshold are removed. Unconnected neurons die after ~{
            Math.round(1 / (params.health_decay_rate ?? 0.0002)).toLocaleString()
          } steps.
        </div>
      </div>

      {/* Run button */}
      <div className="panel-section">
        <button className="ns-btn primary"
          style={{ width: '100%', padding: '10px', fontSize: 13 }}
          disabled={status === 'running' || !hasAnything}
          onClick={run}>
          {status === 'running' ? '⟳  Simulating…' : '▶  Run Simulation'}
        </button>

        {(status === 'done' || status === 'error') && (
          <button className="ns-btn" style={{ width: '100%', marginTop: 6 }}
            onClick={reset}>Reset Status</button>
        )}

        <ResultCard result={result} />
        <ErrorCard  error={error} />
      </div>
    </div>
  )
}
