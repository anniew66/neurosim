// components/ui/NeuronInspector.jsx

import { useState } from 'react'
import useSceneStore    from '../../store/useSceneStore.js'
import useChemicalStore from '../../store/useChemicalStore.js'
import { MORPHOLOGY_NAMES, makeNeurite } from '../../lib/neuronDefaults.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="ns-label">{label}</div>
      {children}
    </div>
  )
}

function CoordRow({ soma, onChange }) {
  return (
    <div className="ns-input-row three">
      {['X', 'Y', 'Z'].map((axis, i) => (
        <div key={axis}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>{axis}</div>
          <input className="ns-input" type="number" step="0.1"
            value={Number(soma[i]).toFixed(3)}
            onChange={e => {
              const next = [...soma]; next[i] = Number(e.target.value); onChange(next)
            }} />
        </div>
      ))}
    </div>
  )
}

// ── Chemical tag list ─────────────────────────────────────────────────────────

function ChemTagList({ label, values, color, onAdd, onRemove }) {
  const allChems  = useChemicalStore(s => s.chemicals)
  const safe      = values ?? []
  const available = allChems.filter(c => !safe.includes(c.id))
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div className="tag-list">
        {safe.map(name => (
          <span key={name} className="tag"
            style={{ color, borderColor: color + '55', cursor: 'pointer' }}
            onClick={() => onRemove(name)}>{name} ✕</span>
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

// ── Chemical registry ─────────────────────────────────────────────────────────

function ChemicalRegistry() {
  const chemicals   = useChemicalStore(s => s.chemicals)
  const addChem     = useChemicalStore(s => s.addChemical)
  const removeChem  = useChemicalStore(s => s.removeChemical)
  const [open, setOpen]         = useState(false)
  const [newId, setNewId]       = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newDesc, setNewDesc]   = useState('')

  const commit = () => {
    if (!newId.trim()) return
    addChem({ id: newId.trim(), label: newLabel || newId.trim(), description: newDesc })
    setNewId(''); setNewLabel(''); setNewDesc('')
  }

  return (
    <div>
      <button className="ns-btn" style={{ fontSize: 11, marginBottom: 8 }}
        onClick={() => setOpen(v => !v)}>
        {open ? '▾' : '▸'} Manage chemicals ({chemicals.length})
      </button>
      {open && (
        <>
          <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border-dim)',
                        borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
            {chemicals.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '4px 8px', borderBottom: '1px solid var(--border-dim)',
                                        fontSize: 11 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 60,
                                color: c.custom ? 'var(--accent-amber)' : 'var(--text-secondary)' }}>
                  {c.label}
                </span>
                <span style={{ flex: 1, color: 'var(--text-dim)', fontSize: 10,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.description}
                </span>
                {c.custom && (
                  <button className="ns-btn icon-only danger"
                    style={{ fontSize: 9, padding: '2px 5px' }}
                    onClick={() => removeChem(c.id)}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)',
                        borderLeft: '3px solid var(--accent-blue)', borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px' }}>
            <div className="ns-label" style={{ marginBottom: 6 }}>New chemical</div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
              <input className="ns-input" placeholder="ID (e.g. NGF)"
                value={newId} onChange={e => setNewId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && commit()}
                style={{ flex: 1, fontFamily: 'var(--font-mono)' }} />
              <input className="ns-input" placeholder="Label"
                value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && commit()}
                style={{ flex: 1 }} />
            </div>
            <input className="ns-input" placeholder="Description (optional)"
              value={newDesc} onChange={e => setNewDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && commit()}
              style={{ marginBottom: 6 }} />
            <button className="ns-btn primary" style={{ width: '100%', fontSize: 11 }}
              disabled={!newId.trim()} onClick={commit}>
              Add Chemical
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Input neuron configuration ────────────────────────────────────────────────

const PRESET_RHYTHMS = [
  { label: 'Tonic (constant)',      mode: 'rate',     rate: 0.3,  seq: null },
  { label: 'Sparse (low rate)',     mode: 'rate',     rate: 0.05, seq: null },
  { label: 'Dense (high rate)',     mode: 'rate',     rate: 0.7,  seq: null },
  { label: 'Burst (10 on / 5 off)', mode: 'sequence', rate: null,
    seq: [...Array(10).fill(1), ...Array(5).fill(0)] },
  { label: 'Theta rhythm (~8 Hz)', mode: 'sequence', rate: null,
    seq: [...Array(124).fill(0), 1] },
  { label: 'Gamma rhythm (~40 Hz)', mode: 'sequence', rate: null,
    seq: [...Array(24).fill(0), 1] },
  { label: 'Alternating (50/50)',  mode: 'sequence', rate: null, seq: [1, 0] },
]

function InputConfig({ neuron, updateNeuron }) {
  const isInput   = neuron.is_input             ?? false
  const startTime = neuron.start_time           ?? 0
  const mode      = neuron.input_mode           ?? 'rate'
  const inputRate = neuron.input_rate           ?? 0.1
  const inputSeq  = neuron.input_sequence       ?? []
  const emitChems = neuron.input_emit_chemicals ?? false

  const [seqText, setSeqText] = useState(inputSeq.join(','))

  const applyPreset = (p) => {
    if (p.seq) {
      updateNeuron(neuron.id, { input_mode: 'sequence', input_sequence: p.seq })
      setSeqText(p.seq.join(','))
    } else {
      updateNeuron(neuron.id, { input_mode: 'rate', input_rate: p.rate })
    }
  }

  const commitSeq = (raw) => {
    const parsed = raw.split(/[,\s]+/).map(v => v.trim()).filter(v => v !== '')
                      .map(v => Number(v) > 0 ? 1 : 0)
    updateNeuron(neuron.id, { input_sequence: parsed })
  }

  return (
    <div>

      {/* Is-input toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div className="ns-label" style={{ marginBottom: 0 }}>Input neuron</div>
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
          onClick={() => updateNeuron(neuron.id, { is_input: !isInput })}>
          {isInput ? 'Yes' : 'No'}
        </button>
      </div>

      {/* Start time — always visible */}
      <Field label="Start time (structural step)">
        <input className="ns-input" type="number" min={0} step={10}
          value={startTime}
          onChange={e => updateNeuron(neuron.id, { start_time: Math.max(0, Number(e.target.value)) })}
          style={{ fontFamily: 'var(--font-mono)' }} />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>
          Neuron stays dormant until this step. Use to stage waves.
        </div>
      </Field>

      {/* Input-only controls — only shown when is_input = true */}
      {isInput && (
        <div style={{ borderLeft: '2px solid var(--accent-blue)',
                      paddingLeft: 10, marginTop: 4 }}>

          {/* Mode */}
          <Field label="Firing mode">
            <div style={{ display: 'flex', gap: 5 }}>
              {['rate', 'sequence'].map(m => (
                <button key={m} className="ns-btn" style={{
                    flex: 1, fontSize: 11,
                    borderColor: mode === m ? 'var(--accent-blue)' : 'var(--border-mid)',
                    color:       mode === m ? 'var(--text-primary)' : 'var(--text-dim)',
                    background:  mode === m ? 'rgba(43,108,176,0.12)' : 'transparent',
                  }}
                  onClick={() => updateNeuron(neuron.id, { input_mode: m })}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </Field>

          {/* Preset rhythms */}
          <Field label="Preset rhythms">
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
          </Field>

          {/* Rate controls */}
          {mode === 'rate' && (
            <Field label={`Fire rate — ${Math.round(inputRate * 1000)} Hz`}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="range" className="ns-slider"
                  min={0} max={1} step={0.005}
                  value={inputRate}
                  onChange={e => updateNeuron(neuron.id, { input_rate: Number(e.target.value) })}
                  style={{ flex: 1 }} />
                <input className="ns-input" type="number" min={0} max={1} step={0.005}
                  value={inputRate.toFixed(3)}
                  onChange={e => updateNeuron(neuron.id, {
                    input_rate: Math.min(1, Math.max(0, Number(e.target.value)))
                  })}
                  style={{ width: 70, fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </div>
            </Field>
          )}

          {/* Sequence controls */}
          {mode === 'sequence' && (
            <Field label={`Sequence — ${inputSeq.length} steps${inputSeq.length > 0 ? ` / ${inputSeq.length} ms` : ''}`}>
              <textarea
                style={{
                  width: '100%', minHeight: 56,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  padding: '5px 7px', resize: 'vertical', outline: 'none',
                }}
                value={seqText}
                onChange={e => setSeqText(e.target.value)}
                onBlur={e => { commitSeq(e.target.value) }}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) commitSeq(seqText) }}
                placeholder="1,0,0,1,0,1,0,0,..."
              />
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                Comma-separated 0s and 1s. Repeats indefinitely. Ctrl+Enter to apply.
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
            </Field>
          )}

          {/* Emit chemicals */}
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', marginTop: 4 }}>
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
              onClick={() => updateNeuron(neuron.id, { input_emit_chemicals: !emitChems })}>
              {emitChems ? 'On' : 'Off'}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

// ── Neurite list ──────────────────────────────────────────────────────────────

function NeuriteList({ neuronId, neurites }) {
  const addNeurite    = useSceneStore(s => s.addNeurite)
  const removeNeurite = useSceneStore(s => s.removeNeurite)
  const updateNeurite = useSceneStore(s => s.updateNeurite)

  return (
    <div>
      {(neurites ?? []).map((nt, i) => (
        <div key={i} className="neurite-row">
          <span className={`neurite-badge ${i === 0 ? 'axon' : 'dendrite'}`}>
            {i === 0 ? 'axon' : `d${i}`}
          </span>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <input className="ns-input" type="number" step="5" min={0} max={360}
              value={Number(nt.azimuth ?? 0).toFixed(0)}
              onChange={e => updateNeurite(neuronId, i, { azimuth: Number(e.target.value) })}
              title="Azimuth °" />
            <input className="ns-input" type="number" step="5" min={-90} max={90}
              value={Number(nt.elevation ?? 0).toFixed(0)}
              onChange={e => updateNeurite(neuronId, i, { elevation: Number(e.target.value) })}
              title="Elevation °" />
          </div>
          {(neurites ?? []).length > 1 && (
            <button className="ns-btn icon-only danger" style={{ fontSize: 10 }}
              onClick={() => removeNeurite(neuronId, i)}>✕</button>
          )}
        </div>
      ))}
      <button className="ns-btn"
        style={{ width: '100%', marginTop: 8, fontSize: 11 }}
        onClick={() => addNeurite(neuronId)}>
        + Add Neurite
      </button>
    </div>
  )
}

// ── Main inspector ────────────────────────────────────────────────────────────

export default function NeuronInspector() {
  const selectedId       = useSceneStore(s => s.selectedNeuronId)
  const neurons          = useSceneStore(s => s.neurons)
  const updateNeuron     = useSceneStore(s => s.updateNeuron)
  const changeMorphology = useSceneStore(s => s.changeMorphology)
  const removeNeurons    = useSceneStore(s => s.removeNeuronsByIds)
  const clearSelection   = useSceneStore(s => s.clearSelection)

  const neuron = neurons.find(n => n.id === selectedId)

  if (!neuron) {
    return (
      <div className="panel-section"
        style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.6 }}>
        Switch to <strong style={{ color: 'var(--accent-amber)' }}>Select [S]</strong> mode
        and click a neuron.
      </div>
    )
  }

  const toggle = (field, name) => {
    const current = neuron[field] ?? []
    const next = current.includes(name)
      ? current.filter(c => c !== name)
      : [...current, name]
    updateNeuron(neuron.id, { [field]: next })
  }

  return (
    <div className="panel-scroll">

      {/* Header */}
      <div className="panel-section"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>Neuron</div>
          <div className="neuron-id" style={{ marginTop: 2 }}>{neuron.id.slice(0, 18)}…</div>
        </div>
        <button className="ns-btn icon-only" onClick={clearSelection}
          title="Deselect" style={{ fontSize: 14 }}>✕</button>
      </div>

      {/* Morphology + position */}
      <div className="panel-section">
        <Field label="Morphology">
          <select className="ns-select" value={neuron.morphology ?? 'generic'}
            onChange={e => changeMorphology(neuron.id, e.target.value)}>
            {MORPHOLOGY_NAMES.map(m => (
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </Field>
        <Field label="Position (mm)">
          <CoordRow soma={neuron.soma ?? [0,0,0]}
            onChange={soma => updateNeuron(neuron.id, { soma })} />
        </Field>
      </div>

      {/* Growth */}
      <div className="panel-section">
        <div className="panel-label">Growth</div>
        <div className="ns-input-row">
          <div>
            <div className="ns-label">Branch prob.</div>
            <input className="ns-input" type="number" step="0.005" min={0} max={1}
              value={neuron.branch_prob ?? 0.02}
              onChange={e => updateNeuron(neuron.id, { branch_prob: Number(e.target.value) })} />
          </div>
          <div>
            <div className="ns-label">Max branch (mm)</div>
            <input className="ns-input" type="number" step="0.1" min={0.01} max={1000}
              value={neuron.max_branch_len ?? 2.0}
              onChange={e => updateNeuron(neuron.id, { max_branch_len: Number(e.target.value) })} />
          </div>
        </div>
      </div>

      {/* Input & Timing */}
      <div className="panel-section">
        <div className="panel-label">Input &amp; Timing</div>
        <InputConfig neuron={neuron} updateNeuron={updateNeuron} />
      </div>

      {/* Chemicals */}
      <div className="panel-section">
        <div className="panel-label">Chemicals</div>
        <ChemTagList label="Releases"
          values={neuron.releases ?? []}
          color="var(--accent-teal)"
          onAdd={n => updateNeuron(neuron.id, { releases: [...(neuron.releases ?? []), n] })}
          onRemove={n => toggle('releases', n)} />
        <ChemTagList label="Attracts"
          values={neuron.attracts ?? []}
          color="var(--accent-blue-lt)"
          onAdd={n => updateNeuron(neuron.id, { attracts: [...(neuron.attracts ?? []), n] })}
          onRemove={n => toggle('attracts', n)} />
        <ChemTagList label="Repels"
          values={neuron.repels ?? []}
          color="var(--accent-red)"
          onAdd={n => updateNeuron(neuron.id, { repels: [...(neuron.repels ?? []), n] })}
          onRemove={n => toggle('repels', n)} />
        <div style={{ marginTop: 10 }}>
          <ChemicalRegistry />
        </div>
      </div>

      {/* Neurites */}
      <div className="panel-section">
        <div className="panel-label">
          Neurites
          <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: 6 }}>
            az / el (°)
          </span>
        </div>
        <NeuriteList neuronId={neuron.id} neurites={neuron.neurites} />
      </div>

      {/* Danger */}
      <div className="panel-section">
        <button className="ns-btn danger" style={{ width: '100%' }}
          onClick={() => { removeNeurons([neuron.id]); clearSelection() }}>
          Remove Neuron
        </button>
      </div>

    </div>
  )
}
