// components/ui/RegionInspector.jsx
// Shown when a bulk region is selected. Edits apply to all neurons in it.

import { useState } from 'react'
import useRegionStore   from '../../store/useRegionStore.js'
import useBrushStore    from '../../store/useBrushStore.js'
import useChemicalStore from '../../store/useChemicalStore.js'
import { MORPHOLOGY_NAMES, MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="ns-label">{label}</div>
      {children}
    </div>
  )
}

// Reads from useChemicalStore so custom chemicals appear
function ChemTagList({ label, values, color, onAdd, onRemove }) {
  const allChems  = useChemicalStore(s => s.chemicals)
  const available = allChems.filter(c => !values.includes(c.id))
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div className="tag-list">
        {values.map(name => (
          <span key={name} className="tag"
            style={{ color, borderColor: color + '55', cursor: 'pointer' }}
            onClick={() => onRemove(name)}>
            {name} ✕
          </span>
        ))}
        {available.length > 0 && (
          <select className="tag tag-add" value=""
            onChange={e => { if (e.target.value) onAdd(e.target.value) }}
            style={{ background: 'transparent', border: '1px dashed var(--border-mid)',
                     cursor: 'pointer' }}>
            <option value="">+ add</option>
            {available.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}{c.custom ? ' ✦' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function PromoteHint() {
  const setMode = useBrushStore(s => s.setMode)
  return (
    <div style={{
      background: 'rgba(192,123,42,0.07)',
      border: '1px solid rgba(192,123,42,0.25)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px', marginBottom: 10,
      fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
    }}>
      <div style={{ color: 'var(--accent-warn)', fontWeight: 700, marginBottom: 4 }}>
        Bulk region — all neurons share these settings
      </div>
      Switch to <strong style={{ color: 'var(--accent-warn)' }}>Promote [O]</strong> brush,
      then drag to extract individual neurons for per-cell editing.
      <div style={{ marginTop: 8 }}>
        <button className="ns-btn"
          style={{ width: '100%', borderColor: 'var(--accent-warn)',
                   color: 'var(--accent-warn)' }}
          onClick={() => setMode('promote')}>
          Switch to Promote Mode
        </button>
      </div>
    </div>
  )
}


const PRESET_RHYTHMS = [
  { label: 'Tonic (constant)',       mode: 'rate',     rate: 0.3,  seq: null },
  { label: 'Sparse (low rate)',      mode: 'rate',     rate: 0.05, seq: null },
  { label: 'Dense (high rate)',      mode: 'rate',     rate: 0.7,  seq: null },
  { label: 'Burst (10 on / 5 off)',  mode: 'sequence', rate: null,
    seq: [...Array(10).fill(1), ...Array(5).fill(0)] },
  { label: 'Theta rhythm (~8 Hz)',   mode: 'sequence', rate: null,
    seq: [...Array(124).fill(0), 1] },
  { label: 'Gamma rhythm (~40 Hz)',  mode: 'sequence', rate: null,
    seq: [...Array(24).fill(0), 1] },
  { label: 'Alternating (50/50)',    mode: 'sequence', rate: null, seq: [1, 0] },
]

function RegionInputConfig({ region, updateRegion }) {
  const isInput   = region.is_input             ?? false
  const startTime = region.start_time           ?? 0
  const mode      = region.input_mode           ?? 'rate'
  const inputRate = region.input_rate           ?? 0.1
  const inputSeq  = region.input_sequence       ?? []
  const emitChems = region.input_emit_chemicals ?? false

  const [seqText, setSeqText] = useState(inputSeq.join(','))

  const applyPreset = (p) => {
    if (p.seq) {
      updateRegion(region.id, { input_mode: 'sequence', input_sequence: p.seq })
      setSeqText(p.seq.join(','))
    } else {
      updateRegion(region.id, { input_mode: 'rate', input_rate: p.rate })
    }
  }

  const commitSeq = (raw) => {
    const parsed = raw.split(/[,\s]+/).map(v => v.trim()).filter(v => v !== '')
                      .map(v => Number(v) > 0 ? 1 : 0)
    updateRegion(region.id, { input_sequence: parsed })
  }

  return (
    <div>
      {/* Is-input toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div className="ns-label" style={{ marginBottom: 0 }}>Input neurons</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Externally driven — no incoming dendrites
          </div>
        </div>
        <button className="ns-btn" style={{
            fontSize: 11, padding: '4px 12px',
            borderColor: isInput ? 'var(--accent-blue)' : 'var(--border-mid)',
            color:       isInput ? 'var(--accent-blue)' : 'var(--text-dim)',
            background:  isInput ? 'rgba(43,108,176,0.1)' : 'transparent',
          }}
          onClick={() => updateRegion(region.id, { is_input: !isInput })}>
          {isInput ? 'Yes' : 'No'}
        </button>
      </div>

      {/* Start time */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'baseline', marginBottom: 3 }}>
          <span className="ns-label" style={{ marginBottom: 0 }}>Start time</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)',
                         fontFamily: 'var(--font-mono)' }}>structural step</span>
        </div>
        <input className="ns-input" type="number" min={0} step={10}
          value={startTime}
          onChange={e => updateRegion(region.id, { start_time: Math.max(0, Number(e.target.value)) })}
          style={{ fontFamily: 'var(--font-mono)' }} />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
          All neurons in region stay dormant until this step.
        </div>
      </div>

      {/* Input-only controls */}
      {isInput && (
        <div style={{ borderLeft: '2px solid var(--accent-blue)', paddingLeft: 10 }}>

          <div style={{ marginBottom: 8 }}>
            <div className="ns-label">Firing mode</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {['rate', 'sequence'].map(m => (
                <button key={m} className="ns-btn" style={{
                    flex: 1, fontSize: 11,
                    borderColor: mode === m ? 'var(--accent-blue)' : 'var(--border-mid)',
                    color:       mode === m ? 'var(--text-primary)' : 'var(--text-dim)',
                    background:  mode === m ? 'rgba(43,108,176,0.12)' : 'transparent',
                  }}
                  onClick={() => updateRegion(region.id, { input_mode: m })}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div className="ns-label">Preset rhythms</div>
            <select className="ns-select" value=""
              onChange={e => {
                const idx = Number(e.target.value)
                if (!isNaN(idx) && PRESET_RHYTHMS[idx]) applyPreset(PRESET_RHYTHMS[idx])
              }}>
              <option value="">— apply preset —</option>
              {PRESET_RHYTHMS.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
            </select>
          </div>

          {mode === 'rate' && (
            <div style={{ marginBottom: 8 }}>
              <div className="ns-label">
                Fire rate — {Math.round(inputRate * 1000)} Hz
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="range" className="ns-slider"
                  min={0} max={1} step={0.005}
                  value={inputRate}
                  onChange={e => updateRegion(region.id, { input_rate: Number(e.target.value) })}
                  style={{ flex: 1 }} />
                <input className="ns-input" type="number" min={0} max={1} step={0.005}
                  value={inputRate.toFixed(3)}
                  onChange={e => updateRegion(region.id, {
                    input_rate: Math.min(1, Math.max(0, Number(e.target.value)))
                  })}
                  style={{ width: 70, fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </div>
            </div>
          )}

          {mode === 'sequence' && (
            <div style={{ marginBottom: 8 }}>
              <div className="ns-label">
                Sequence — {inputSeq.length} steps
              </div>
              <textarea
                style={{
                  width: '100%', minHeight: 52,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  padding: '5px 7px', resize: 'vertical', outline: 'none',
                }}
                value={seqText}
                onChange={e => setSeqText(e.target.value)}
                onBlur={e => commitSeq(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) commitSeq(seqText) }}
                placeholder="1,0,0,1,0,1,..."
              />
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                Comma-separated 0s and 1s. Repeats indefinitely.
              </div>
              {inputSeq.length > 0 && (
                <div style={{ display: 'flex', gap: 1, marginTop: 5,
                               flexWrap: 'nowrap', overflow: 'hidden', height: 12 }}>
                  {inputSeq.slice(0, 120).map((v, i) => (
                    <div key={i} style={{
                      width: 4, height: 12, flexShrink: 0,
                      background: v ? 'var(--accent-blue)' : 'var(--bg-active)',
                      borderRadius: 1,
                    }} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center' }}>
            <div>
              <div className="ns-label" style={{ marginBottom: 0 }}>Emit chemicals</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                Activity-dependent release
              </div>
            </div>
            <button className="ns-btn" style={{
                fontSize: 11, padding: '3px 10px',
                borderColor: emitChems ? 'var(--accent-teal)' : 'var(--border-mid)',
                color:       emitChems ? 'var(--accent-teal)' : 'var(--text-dim)',
              }}
              onClick={() => updateRegion(region.id, { input_emit_chemicals: !emitChems })}>
              {emitChems ? 'On' : 'Off'}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

export default function RegionInspector() {
  const selectedId   = useRegionStore(s => s.selectedRegionId)
  const regions      = useRegionStore(s => s.regions)
  const updateRegion = useRegionStore(s => s.updateRegion)
  const removeRegion = useRegionStore(s => s.removeRegion)
  const clearSel     = useRegionStore(s => s.selectRegion)

  const region = regions.find(r => r.id === selectedId)

  if (!region) {
    return (
      <div className="panel-section"
        style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.6 }}>
        Switch to <strong style={{ color: 'var(--accent-warn)' }}>Select [S]</strong> mode,
        then click a painted region.
      </div>
    )
  }

  const toggle = (field, name) => {
    const current = region[field] ?? []
    const next = current.includes(name)
      ? current.filter(c => c !== name)
      : [...current, name]
    updateRegion(region.id, { [field]: next })
  }

  const neuronCount = region.positions ? region.positions.length / 3 : 0
  const def = MORPHOLOGY_DEFAULTS[region.morphology] ?? MORPHOLOGY_DEFAULTS.generic

  return (
    <div className="panel-scroll">

      {/* Header */}
      <div className="panel-section"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
            Region
          </div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)',
                        color: 'var(--text-dim)', marginTop: 2 }}>
            {neuronCount.toLocaleString()} neurons
          </div>
        </div>
        <button className="ns-btn icon-only"
          onClick={() => clearSel(null)} title="Deselect"
          style={{ fontSize: 14 }}>✕</button>
      </div>

      <div className="panel-section">
        <PromoteHint />
      </div>

      {/* Morphology */}
      <div className="panel-section">
        <Field label="Morphology">
          <select className="ns-select" value={region.morphology}
            onChange={e => updateRegion(region.id, { morphology: e.target.value })}>
            {MORPHOLOGY_NAMES.map(m => (
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
            {def.description}
          </div>
        </Field>
      </div>

      {/* Input & Timing */}
      <div className="panel-section">
        <div className="panel-label">Input &amp; Timing</div>
        <RegionInputConfig region={region} updateRegion={updateRegion} />
      </div>

      {/* Chemicals */}
      <div className="panel-section">
        <div className="panel-label">Chemicals</div>
        <ChemTagList
          label="Releases"
          values={region.releases ?? []}
          color="var(--accent-teal)"
          onAdd={n => toggle('releases', n)}
          onRemove={n => toggle('releases', n)} />
        <ChemTagList
          label="Attracts"
          values={region.attracts ?? []}
          color="var(--accent-axon)"
          onAdd={n => toggle('attracts', n)}
          onRemove={n => toggle('attracts', n)} />
        <ChemTagList
          label="Repels"
          values={region.repels ?? []}
          color="var(--accent-dend)"
          onAdd={n => toggle('repels', n)}
          onRemove={n => toggle('repels', n)} />
      </div>

      {/* Danger */}
      <div className="panel-section">
        <button className="ns-btn danger" style={{ width: '100%' }}
          onClick={() => { removeRegion(region.id); clearSel(null) }}>
          Remove Region
        </button>
      </div>
    </div>
  )
}
