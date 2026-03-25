// components/ui/BrushPanel.jsx

import SliderWithInput          from './SliderWithInput.jsx'
import useTissueDensityStore from '../../store/useTissueDensityStore.js'
import useBrushStore from '../../store/useBrushStore.js'
import { MORPHOLOGY_NAMES, MORPHOLOGY_DEFAULTS, KNOWN_CHEMICALS } from '../../lib/neuronDefaults.js'

function NeuronIdentitySettings() {
  const morphology    = useBrushStore(s => s.morphology)
  const neuriteCount  = useBrushStore(s => s.neuriteCount)
  const setMorphology   = useBrushStore(s => s.setMorphology)
  const setNeuriteCount = useBrushStore(s => s.setNeuriteCount)
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
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5, lineHeight: 1.4 }}>
          {def.description}
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                      lineHeight: 1.8, marginTop: 6 }}>
          <div>soma r: <span style={{ color: 'var(--accent-chem)' }}>
            {(def.soma_radius * 1000).toFixed(1)} µm ± {(def.soma_radius_noise * 1000).toFixed(1)} µm
          </span></div>
          <div>max neurite: <span style={{ color: 'var(--accent-axon)' }}>
            {def.max_branch_length >= 1
              ? `${def.max_branch_length.toFixed(1)} mm`
              : `${(def.max_branch_length * 1000).toFixed(0)} µm`}
          </span></div>
        </div>
      </div>

      <SliderWithInput label="Neurites / neuron" value={neuriteCount}
        min={1} max={8} rangeSpan={4} unit=""
        onChange={v => setNeuriteCount(Math.round(v))} format={v => Math.round(v).toString()} />

      <div style={{ marginTop: 4 }}>
        <div className="ns-label">Default chemicals</div>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                      lineHeight: 1.8 }}>
          <div>releases: <span style={{ color: 'var(--accent-chem)' }}>{def.releases.join(', ') || '—'}</span></div>
          <div>attracts: <span style={{ color: 'var(--accent-axon)' }}>{def.attracts.join(', ') || '—'}</span></div>
          <div>repels:   <span style={{ color: 'var(--accent-dend)' }}>{def.repels.join(', ')   || '—'}</span></div>
        </div>
      </div>
    </>
  )
}

function ChemicalSettings() {
  const chemical    = useBrushStore(s => s.chemical)
  const setChemical = useBrushStore(s => s.setChemical)
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <div className="ns-label">Chemical</div>
        <select className="ns-select" value={chemical.name}
          onChange={e => setChemical({ name: e.target.value })}>
          {KNOWN_CHEMICALS.map(c => (
            <option key={c.id} value={c.id}>{c.label} — {c.description}</option>
          ))}
        </select>
      </div>
      {/* Sigma: 0.01 mm (10 µm) to 10 mm, log scale */}
      <SliderWithInput label="Diffusion σ" value={chemical.sigma}
        absMin={0.0001} absMax={50} unit="mm" log
        onChange={v => setChemical({ sigma: v })} />
      <SliderWithInput label="Strength" value={chemical.strength}
        absMin={0} absMax={20} unit="×"
        onChange={v => setChemical({ strength: v })} />
    </>
  )
}

const MODE_HINTS = {
  point:   'Click to place a single precise neuron. Opens in the Inspector immediately.',
  area:    'Click and drag to paint a bulk neuron region. Release to commit the stroke.',
  carve:   'Drag over a bulk region to erase neurons from it.',
  promote: 'Drag over a bulk region to extract those neurons as individually-editable precise neurons.',
  erase:   'Drag to erase precise neurons under the brush.',
  select:  'Click a precise neuron or a painted region to inspect it.',
  density: 'Paint tissue density. Dense regions impede neurite growth and chemical diffusion.',
}


function DensityBrushSettings() {
  const brushDensity = useTissueDensityStore(s => s.brushDensity)
  const setBrush     = useTissueDensityStore(s => s.setBrushDensity)
  const baseDensity  = useTissueDensityStore(s => s.baseDensity)
  const setBase      = useTissueDensityStore(s => s.setBaseDensity)
  const clearGrid    = useTissueDensityStore(s => s.clearGrid)
  const isEmpty      = useTissueDensityStore(s => s.isEmpty)

  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
                    marginBottom: 10 }}>
        Paint neuropil density onto the surface. Dense regions slow growth cones,
        add gradient noise, and compress chemical diffusion. Carve low-density
        corridors to guide long axons.
      </div>

      <SliderWithInput label="Base density (whole volume)" value={baseDensity}
        min={0} max={1} rangeSpan={0.5} unit="%"
        onChange={setBase} format={v => `${Math.round(v * 100)}`} />

      <SliderWithInput label="Brush value" value={brushDensity}
        min={-1} max={1} rangeSpan={0.5} unit="%"
        onChange={setBrush}
        format={v => (v >= 0 ? '+' : '') + Math.round(v * 100)} />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>
        Positive = add density. Negative = carve corridor below base.
      </div>

      <button className="ns-btn danger" style={{ width: '100%' }}
        disabled={isEmpty()}
        onClick={clearGrid}>
        Clear Painted Density
      </button>
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
