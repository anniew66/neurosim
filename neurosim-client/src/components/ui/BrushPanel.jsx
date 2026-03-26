// components/ui/BrushPanel.jsx

import SliderWithInput          from './SliderWithInput.jsx'
import useTissueDensityStore from '../../store/useTissueDensityStore.js'
import useBrushStore       from '../../store/useBrushStore.js'
import useChemicalStore    from '../../store/useChemicalStore.js'
import { MORPHOLOGY_NAMES, MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

function ChemicalSettings() {
  const chemical    = useBrushStore(s => s.chemical)
  const setChemical = useBrushStore(s => s.setChemical)
  const allChems    = useChemicalStore(s => s.chemicals)
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <div className="ns-label">Chemical</div>
        <select className="ns-select" value={chemical.name}
          onChange={e => setChemical({ name: e.target.value })}>
          {allChems.map(ch => (
            <option key={ch.id} value={ch.id}>
              {ch.label}{ch.custom ? ' ✦' : ''} — {ch.description}
            </option>
          ))}
        </select>
      </div>
      <SliderWithInput label="Diffusion σ" value={chemical.sigma ?? 3.0}
        absMin={0.0001} absMax={50} unit="mm" log
        onChange={v => setChemical({ sigma: v })} />
      <SliderWithInput label="Strength" value={chemical.strength ?? 1.0}
        absMin={0} absMax={20} unit="×"
        onChange={v => setChemical({ strength: v })} />
    </>
  )
}


function DensityBrushSettings() {
  const brushDensity = useTissueDensityStore(s => s.brushDensity)
  const setBrush     = useTissueDensityStore(s => s.setBrushDensity)
  const baseDensity  = useTissueDensityStore(s => s.baseDensity)
  const setBase      = useTissueDensityStore(s => s.setBaseDensity)
  const clearGrid    = useTissueDensityStore(s => s.clearGrid)
  const isEmpty      = useTissueDensityStore(s => s.isEmpty)
  const cellDensity  = useTissueDensityStore(s => s.neuropilCellDensity)
  const blobRadius   = useTissueDensityStore(s => s.neuropilBlobRadius)
  const intensity    = useTissueDensityStore(s => s.neuropilIntensity)
  const setCellDensity  = useTissueDensityStore(s => s.setNeuropilCellDensity)
  const setBlobRadius   = useTissueDensityStore(s => s.setNeuropilBlobRadius)
  const setIntensity    = useTissueDensityStore(s => s.setNeuropilIntensity)

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
        Paint neuropil density onto the surface. Dense regions slow growth cones,
        add gradient noise, and compress chemical diffusion.
      </div>

      <SliderWithInput label="Base density (whole volume)" value={baseDensity}
        min={0} max={1} rangeSpan={0.5} unit="%"
        onChange={setBase} format={v => `${Math.round(v * 100)}`} />

      <SliderWithInput label="Brush value" value={brushDensity}
        min={-1} max={1} rangeSpan={0.5} unit="%"
        onChange={setBrush}
        format={v => (v >= 0 ? '+' : '') + Math.round(v * 100)} />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>
        Positive = add density. Negative = carve corridor. Ctrl+Z undoes each stroke.
      </div>

      <div className="panel-label">Procedural Neuropil</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
        Fill the volume with random neuron-sized blobs leaving narrow gaps.
      </div>

      <SliderWithInput label="Cell density" value={cellDensity}
        min={10} max={200000} unit="/mm³" log
        onChange={setCellDensity}
        format={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)} />

      <div style={{ marginBottom: 8 }}>
        <div className="ns-label">Blob radius</div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
          {Object.entries(MORPHOLOGY_DEFAULTS).map(([k, d]) => (
            <button key={k} className="ns-btn"
              style={{ fontSize: 9, padding: '2px 6px', flex: 1,
                borderColor: Math.abs(blobRadius - d.soma_radius) < 0.0001
                  ? 'var(--accent-blue)' : 'var(--border-mid)',
                color: Math.abs(blobRadius - d.soma_radius) < 0.0001
                  ? 'var(--text-primary)' : 'var(--text-dim)' }}
              title={`${k}: ${(d.soma_radius*1000).toFixed(1)} µm`}
              onClick={() => setBlobRadius(d.soma_radius)}>
              {k.slice(0,3)}
            </button>
          ))}
        </div>
        <SliderWithInput value={blobRadius} min={0.001} max={0.1} unit="mm" log
          onChange={setBlobRadius} format={v => `${(v*1000).toFixed(1)} µm`} />
      </div>

      <SliderWithInput label="Blob intensity" value={intensity}
        min={0.05} max={1} rangeSpan={0.4} unit=""
        onChange={setIntensity} format={v => `${Math.round(v * 100)}%`} />

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="ns-btn primary" style={{ flex: 1 }}
          onClick={() => useTissueDensityStore.getState().initNeuropil()}>
          Generate
        </button>
        <button className="ns-btn danger" style={{ flex: 1 }}
          disabled={isEmpty()}
          onClick={clearGrid}>
          Clear
        </button>
      </div>
    </>
  )
}

const MODE_HINTS = {
  point:    'Click to place a single precise neuron. Opens in the Inspector immediately.',
  area:     'Click and drag to paint a bulk neuron region. Release to commit the stroke.',
  carve:    'Drag over a bulk region to erase neurons from it.',
  promote:  'Drag over a bulk region to extract those neurons as individually-editable precise neurons.',
  erase:    'Drag to erase precise neurons under the brush.',
  select:   'Click a precise neuron or a painted region to inspect it.',
  density:  'Paint tissue density. Dense regions impede neurite growth and chemical diffusion.',
  chemical: 'Place a free-floating chemical source — no neuron attached. Simulates injected signalling molecules.',
}

// Inline tag-list reading from brush store + chemical store
function BrushChemList({ label, field, color }) {
  const values   = useBrushStore(s => s.brushChems?.[field] ?? [])
  const setChems = useBrushStore(s => s.setBrushChems)
  const allChems = useChemicalStore(s => s.chemicals)
  const available = allChems.filter(c => !values.includes(c.id))
  const add    = id => setChems(field, [...values, id])
  const remove = id => setChems(field, values.filter(v => v !== id))
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>{label}</div>
      <div className="tag-list">
        {values.map(name => (
          <span key={name} className="tag" style={{ color, borderColor: color + '55' }}
            onClick={() => remove(name)}>{name} ✕</span>
        ))}
        {available.length > 0 && (
          <select className="tag tag-add" value=""
            onChange={e => { if (e.target.value) add(e.target.value) }}
            style={{ background: 'transparent', border: '1px dashed var(--border-mid)', cursor: 'pointer' }}>
            <option value="">+ add</option>
            {available.map(c => (
              <option key={c.id} value={c.id}>{c.label}{c.custom ? ' ✦' : ''}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function NeuronIdentitySettings() {
  const morphology      = useBrushStore(s => s.morphology)
  const setMorphology   = useBrushStore(s => s.setMorphology)
  const useDefaults     = useBrushStore(s => s.brushChemsUseDefaults ?? true)
  const setUseDefaults  = useBrushStore(s => s.setBrushChemsUseDefaults)
  const brushIsInput    = useBrushStore(s => s.brushIsInput ?? false)
  const setBrushIsInput = useBrushStore(s => s.setBrushIsInput)
  const brushStartTime  = useBrushStore(s => s.brushStartTime ?? 0)
  const setBrushStartTime = useBrushStore(s => s.setBrushStartTime)
  const def = MORPHOLOGY_DEFAULTS[morphology] ?? MORPHOLOGY_DEFAULTS.generic

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <div className="ns-label">Morphology</div>
        <select className="ns-select" value={morphology}
          onChange={e => setMorphology(e.target.value)}>
          {MORPHOLOGY_NAMES.map(m => (
            <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
          {def.description}
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                      lineHeight: 1.8, marginTop: 4 }}>
          soma r: {(def.soma_radius * 1000).toFixed(1)} µm
          {' · '}
          max {def.max_branch_length >= 1
            ? `${def.max_branch_length.toFixed(1)} mm`
            : `${(def.max_branch_length * 1000).toFixed(0)} µm`}
        </div>
      </div>

      {/* Input designation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 8, padding: '6px 8px',
                    background: brushIsInput ? 'rgba(43,108,176,0.08)' : 'var(--bg-elevated)',
                    border: `1px solid ${brushIsInput ? 'var(--accent-blue)' : 'var(--border-dim)'}`,
                    borderRadius: 'var(--radius-sm)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600,
                        color: brushIsInput ? 'var(--accent-blue)' : 'var(--text-secondary)' }}>
            Input neuron
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
            Externally driven, no incoming dendrites
          </div>
        </div>
        <button className="ns-btn" style={{
            fontSize: 11, padding: '3px 10px',
            borderColor: brushIsInput ? 'var(--accent-blue)' : 'var(--border-mid)',
            color:       brushIsInput ? 'var(--accent-blue)' : 'var(--text-dim)',
            background:  brushIsInput ? 'rgba(43,108,176,0.1)' : 'transparent',
          }}
          onClick={() => setBrushIsInput(!brushIsInput)}>
          {brushIsInput ? 'Yes' : 'No'}
        </button>
      </div>

      {/* Start time */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      marginBottom: 3 }}>
          <span className="ns-label" style={{ marginBottom: 0 }}>Start time</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            structural step
          </span>
        </div>
        <input className="ns-input" type="number" min={0} step={10}
          value={brushStartTime}
          onChange={e => setBrushStartTime(Math.max(0, Number(e.target.value)))}
          style={{ fontFamily: 'var(--font-mono)' }} />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>
          Neurons dormant until this step. 0 = activate immediately.
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: 6 }}>
          <div className="ns-label" style={{ marginBottom: 0 }}>Chemical affinities</div>
          <button className="ns-btn" style={{ fontSize: 10, padding: '2px 7px' }}
            onClick={() => setUseDefaults(!useDefaults)}>
            {useDefaults ? 'Morphology defaults' : 'Custom'}
          </button>
        </div>
        {useDefaults ? (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            <div>releases: <span style={{ color: 'var(--accent-teal)' }}>{def.releases.join(', ') || '—'}</span></div>
            <div>attracts: <span style={{ color: 'var(--accent-blue-lt)' }}>{def.attracts.join(', ') || '—'}</span></div>
            <div>repels: <span style={{ color: 'var(--accent-red)' }}>{def.repels.join(', ') || '—'}</span></div>
          </div>
        ) : (
          <>
            <BrushChemList label="Releases" field="releases" color="var(--accent-teal)" />
            <BrushChemList label="Attracts" field="attracts" color="var(--accent-blue-lt)" />
            <BrushChemList label="Repels"   field="repels"   color="var(--accent-red)" />
          </>
        )}
      </div>
    </>
  )
}


export default function BrushPanel() {
  const mode           = useBrushStore(s => s.mode)
  const brushRadius    = useBrushStore(s => s.brushRadius)
  const density        = useBrushStore(s => s.density)
  const jitter         = useBrushStore(s => s.jitterAmount)
  const setBrushRadius = useBrushStore(s => s.setBrushRadius)
  const setDensity     = useBrushStore(s => s.setDensity)
  const setJitter      = useBrushStore(s => s.setJitter)

  const showRadius       = ['point', 'area', 'carve', 'promote', 'erase', 'density'].includes(mode)
  const showAreaDensity  = mode === 'area'      // density/scatter sliders inside area brush
  const showIdent        = ['point', 'area'].includes(mode)
  const showDensityBrush = mode === 'density'   // tissue density brush settings panel
  const showChem         = mode === 'chemical'

  return (
    <div className="panel-scroll">
      <div className="panel-section">
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
                      padding: '4px 0', fontStyle: 'italic' }}>
          {MODE_HINTS[mode]}
        </div>
      </div>

      {showRadius && (
        <div className="panel-section">
          <div className="panel-label">Brush</div>
          {/* Radius: 0.001 mm (1 µm) to 50 mm (whole-brain region), log scale */}
          <SliderWithInput label="Radius" value={brushRadius}
            absMin={0.0001} absMax={200} unit="mm" log
            onChange={setBrushRadius} />

          {showAreaDensity && (
            <>
              {/* Density: neurons per mm³, log scale */}
              <SliderWithInput label="Density" value={density}
                absMin={0.001} absMax={200000} unit="/mm³" log
                onChange={setDensity}
                format={v => v >= 1 ? v.toFixed(1) : v.toExponential(2)} />
              <SliderWithInput label="Scatter" value={jitter}
                min={0} max={1} rangeSpan={0.5} unit="%"
                onChange={setJitter}
                format={v => `${Math.round(v * 100)}`} />
            </>
          )}
        </div>
      )}

      {showIdent && (
        <div className="panel-section">
          <div className="panel-label">Neuron Identity</div>
          <NeuronIdentitySettings />
        </div>
      )}

      {showDensityBrush && (
        <div className="panel-section">
          <div className="panel-label">Tissue Density</div>
          <DensityBrushSettings />
        </div>
      )}

      {showChem && (
        <div className="panel-section">
          <div className="panel-label">Chemical</div>
          <ChemicalSettings />
        </div>
      )}
    </div>
  )
}
