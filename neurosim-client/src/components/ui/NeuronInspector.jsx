// components/ui/NeuronInspector.jsx
// Right sidebar top section.
// Shows editable properties for the selected neuron.
// Appears only when a neuron is selected in 'select' mode.

import useSceneStore from '../../store/useSceneStore.js'
import { MORPHOLOGY_NAMES, KNOWN_CHEMICALS, MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

// ── Small helpers ─────────────────────────────────────────────────────────────

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
      {['x', 'y', 'z'].map((axis, i) => (
        <div key={axis}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>{axis.toUpperCase()}</div>
          <input
            className="ns-input"
            type="number"
            step="0.1"
            value={Number(soma[i]).toFixed(2)}
            onChange={e => {
              const next = [...soma]
              next[i] = Number(e.target.value)
              onChange(next)
            }}
          />
        </div>
      ))}
    </div>
  )
}

function ChemTagList({ label, values, allChems, color, onAdd, onRemove }) {
  const available = allChems.filter(c => !values.includes(c.id))
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div className="tag-list">
        {values.map(name => (
          <span
            key={name}
            className="tag"
            style={{ color, borderColor: color + '55' }}
            title="Click to remove"
            onClick={() => onRemove(name)}
          >
            {name} ✕
          </span>
        ))}
        {available.length > 0 && (
          <select
            className="tag tag-add"
            value=""
            onChange={e => { if (e.target.value) onAdd(e.target.value) }}
            style={{ background: 'transparent', border: '1px dashed var(--border-mid)', cursor: 'pointer' }}
          >
            <option value="">+ add</option>
            {available.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function NeuriteList({ neuronId, neurites }) {
  const addNeurite    = useSceneStore(s => s.addNeurite)
  const removeNeurite = useSceneStore(s => s.removeNeurite)
  const updateNeurite = useSceneStore(s => s.updateNeurite)

  return (
    <div>
      {neurites.map((nt, i) => (
        <div key={i} className="neurite-row">
          <span className={`neurite-badge ${i === 0 ? 'axon' : 'dendrite'}`}>
            {i === 0 ? 'axon' : `dend ${i}`}
          </span>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <input
              className="ns-input"
              type="number"
              step="5"
              min={0} max={360}
              value={Number(nt.azimuth).toFixed(0)}
              onChange={e => updateNeurite(neuronId, i, { azimuth: Number(e.target.value) })}
              title="Azimuth (°)"
            />
            <input
              className="ns-input"
              type="number"
              step="5"
              min={-90} max={90}
              value={Number(nt.elevation).toFixed(0)}
              onChange={e => updateNeurite(neuronId, i, { elevation: Number(e.target.value) })}
              title="Elevation (°)"
            />
          </div>
          {neurites.length > 1 && (
            <button
              className="ns-btn icon-only danger"
              style={{ fontSize: 10 }}
              onClick={() => removeNeurite(neuronId, i)}
              title="Remove neurite"
            >✕</button>
          )}
        </div>
      ))}
      <button
        className="ns-btn"
        style={{ width: '100%', marginTop: 8, fontSize: 11 }}
        onClick={() => addNeurite(neuronId)}
      >
        + Add Neurite
      </button>
    </div>
  )
}

// ── Main inspector ────────────────────────────────────────────────────────────

export default function NeuronInspector() {
  const selectedId      = useSceneStore(s => s.selectedNeuronId)
  const neurons         = useSceneStore(s => s.neurons)
  const updateNeuron    = useSceneStore(s => s.updateNeuron)
  const changeMorphology = useSceneStore(s => s.changeMorphology)
  const removeNeurons   = useSceneStore(s => s.removeNeuronsByIds)
  const clearSelection  = useSceneStore(s => s.clearSelection)

  const neuron = neurons.find(n => n.id === selectedId)

  if (!neuron) {
    return (
      <div className="panel-section" style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.6 }}>
        Switch to <strong style={{ color: 'var(--accent-warn)' }}>Select</strong> mode [S] and click
        a neuron to inspect it.
      </div>
    )
  }

  const toggleChem = (field, name) => {
    const current = neuron[field]
    const next = current.includes(name)
      ? current.filter(c => c !== name)
      : [...current, name]
    updateNeuron(neuron.id, { [field]: next })
  }

  return (
    <div className="panel-scroll">
      {/* Header */}
      <div className="panel-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
            Neuron
          </div>
          <div className="neuron-id" style={{ marginTop: 2 }}>
            {neuron.id.slice(0, 18)}…
          </div>
        </div>
        <button
          className="ns-btn icon-only"
          onClick={clearSelection}
          title="Deselect"
          style={{ fontSize: 14 }}
        >✕</button>
      </div>

      {/* Morphology */}
      <div className="panel-section">
        <Field label="Morphology">
          <select
            className="ns-select"
            value={neuron.morphology}
            onChange={e => changeMorphology(neuron.id, e.target.value)}
          >
            {MORPHOLOGY_NAMES.map(m => (
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </Field>

        <Field label="Position">
          <CoordRow
            soma={neuron.soma}
            onChange={soma => updateNeuron(neuron.id, { soma })}
          />
        </Field>
      </div>

      {/* Branching */}
      <div className="panel-section">
        <div className="panel-label">Growth</div>
        <div className="ns-input-row">
          <div>
            <div className="ns-label">Branch prob.</div>
            <input
              className="ns-input"
              type="number"
              step="0.005"
              min={0} max={1}
              value={neuron.branch_prob}
              onChange={e => updateNeuron(neuron.id, { branch_prob: Number(e.target.value) })}
            />
          </div>
          <div>
            <div className="ns-label">Max branch len.</div>
            <input
              className="ns-input"
              type="number"
              step="1"
              min={1} max={200}
              value={neuron.max_branch_len}
              onChange={e => updateNeuron(neuron.id, { max_branch_len: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* Chemicals */}
      <div className="panel-section">
        <div className="panel-label">Chemicals</div>
        <ChemTagList
          label="Releases"
          values={neuron.releases}
          allChems={KNOWN_CHEMICALS}
          color="var(--accent-chem)"
          onAdd={n => updateNeuron(neuron.id, { releases: [...neuron.releases, n] })}
          onRemove={n => toggleChem('releases', n)}
        />
        <ChemTagList
          label="Attracts"
          values={neuron.attracts}
          allChems={KNOWN_CHEMICALS}
          color="var(--accent-axon)"
          onAdd={n => updateNeuron(neuron.id, { attracts: [...neuron.attracts, n] })}
          onRemove={n => toggleChem('attracts', n)}
        />
        <ChemTagList
          label="Repels"
          values={neuron.repels}
          allChems={KNOWN_CHEMICALS}
          color="var(--accent-dend)"
          onAdd={n => updateNeuron(neuron.id, { repels: [...neuron.repels, n] })}
          onRemove={n => toggleChem('repels', n)}
        />
      </div>

      {/* Neurites */}
      <div className="panel-section">
        <div className="panel-label">Neurites <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>az / el (°)</span></div>
        <NeuriteList neuronId={neuron.id} neurites={neuron.neurites} />
      </div>

      {/* Danger zone */}
      <div className="panel-section">
        <button
          className="ns-btn danger"
          style={{ width: '100%' }}
          onClick={() => { removeNeurons([neuron.id]); clearSelection() }}
        >
          Remove Neuron
        </button>
      </div>
    </div>
  )
}
