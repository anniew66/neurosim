// components/ui/BrushPanel.jsx

import useBrushStore from '../../store/useBrushStore.js'
import { MORPHOLOGY_NAMES, MORPHOLOGY_DEFAULTS, KNOWN_CHEMICALS } from '../../lib/neuronDefaults.js'

function SliderRow({ label, value, min, max, step, onChange, format }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span className="ns-label">{label}</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-accent)' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input type="range" className="ns-slider"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  )
}

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
      </div>
      <SliderRow label="Neurites / neuron" value={neuriteCount}
        min={1} max={8} step={1} onChange={setNeuriteCount} format={v => v} />
      <div style={{ marginTop: 4 }}>
        <div className="ns-label">Defaults</div>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <div>releases: <span style={{ color: 'var(--accent-chem)' }}>{def.releases.join(', ') || '—'}</span></div>
          <div>attracts: <span style={{ color: 'var(--accent-axon)' }}>{def.attracts.join(', ') || '—'}</span></div>
          <div>repels: <span style={{ color: 'var(--accent-dend)' }}>{def.repels.join(', ') || '—'}</span></div>
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
      <SliderRow label="Diffusion σ" value={chemical.sigma}
        min={0.5} max={20} step={0.5}
        onChange={v => setChemical({ sigma: v })} format={v => v.toFixed(1)} />
      <SliderRow label="Strength" value={chemical.strength}
        min={0.1} max={5} step={0.1}
        onChange={v => setChemical({ strength: v })} format={v => v.toFixed(1)} />
    </>
  )
}

const MODE_HINTS = {
  point:   'Click to place a single neuron. Opens in the Inspector immediately.',
  area:    'Click and drag to paint a bulk region. Release to commit the stroke.',
  carve:   'Drag over a bulk region to erase neurons from it.',
  promote: 'Drag over a bulk region to extract those neurons as individually-editable precise neurons.',
  erase:   'Drag to erase precise neurons under the brush.',
  select:  'Click a precise neuron or a region to inspect and edit it.',
}

export default function BrushPanel() {
  const mode           = useBrushStore(s => s.mode)
  const brushRadius    = useBrushStore(s => s.brushRadius)
  const density        = useBrushStore(s => s.density)
  const jitter         = useBrushStore(s => s.jitterAmount)
  const setBrushRadius = useBrushStore(s => s.setBrushRadius)
  const setDensity     = useBrushStore(s => s.setDensity)
  const setJitter      = useBrushStore(s => s.setJitter)

  const showRadius  = ['point', 'area', 'carve', 'promote', 'erase'].includes(mode)
  const showDensity = mode === 'area'
  const showIdent   = ['point', 'area'].includes(mode)
  const showChem    = mode === 'chemical'

  return (
    <div className="panel-scroll">
      {/* Mode hint */}
      <div className="panel-section">
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
                      padding: '4px 0', fontStyle: 'italic' }}>
          {MODE_HINTS[mode]}
        </div>
      </div>

      {/* Brush geometry */}
      {showRadius && (
        <div className="panel-section">
          <div className="panel-label">Brush</div>
          <SliderRow label="Radius" value={brushRadius}
            min={0.3} max={15} step={0.1}
            onChange={setBrushRadius} format={v => `${v.toFixed(1)} u`} />
          {showDensity && (
            <>
              <SliderRow label="Density" value={density}
                min={0.002} max={0.5} step={0.002}
                onChange={setDensity} format={v => `${v.toFixed(3)} /u³`} />
              <SliderRow label="Scatter" value={jitter}
                min={0} max={1} step={0.05}
                onChange={setJitter} format={v => `${Math.round(v * 100)}%`} />
            </>
          )}
        </div>
      )}

      {/* Neuron identity */}
      {showIdent && (
        <div className="panel-section">
          <div className="panel-label">Neuron Identity</div>
          <NeuronIdentitySettings />
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
