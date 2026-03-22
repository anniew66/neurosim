// components/ui/RegionInspector.jsx
// Shown in the right sidebar when a bulk region is selected.
// Edits apply to ALL neurons in that region at once.
// "Promote" button opens carve-to-precise workflow.

import useRegionStore from '../../store/useRegionStore.js'
import useBrushStore  from '../../store/useBrushStore.js'
import { MORPHOLOGY_NAMES, KNOWN_CHEMICALS, MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="ns-label">{label}</div>
      {children}
    </div>
  )
}

function ChemTagList({ label, values, color, onAdd, onRemove }) {
  const available = KNOWN_CHEMICALS.filter(c => !values.includes(c.id))
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div className="tag-list">
        {values.map(name => (
          <span
            key={name}
            className="tag"
            style={{ color, borderColor: color + '55', cursor: 'pointer' }}
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

function PromoteHint() {
  const setMode = useBrushStore(s => s.setMode)
  return (
    <div style={{
      background: 'rgba(255,179,0,0.07)',
      border: '1px solid rgba(255,179,0,0.25)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontSize: 11,
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      <div style={{ color: 'var(--accent-warn)', fontWeight: 700, marginBottom: 4 }}>
        Promote neurons to precise
      </div>
      Switch to <strong style={{ color: 'var(--accent-warn)' }}>Promote [O]</strong> brush,
      then drag over part of this region. Those neurons will be extracted into
      individually-editable precise neurons.
      <br /><br />
      <button
        className="ns-btn"
        style={{ width: '100%', borderColor: 'var(--accent-warn)', color: 'var(--accent-warn)' }}
        onClick={() => setMode('promote')}
      >
        Switch to Promote brush
      </button>
    </div>
  )
}

export default function RegionInspector() {
  const selectedId    = useRegionStore(s => s.selectedRegionId)
  const regions       = useRegionStore(s => s.regions)
  const updateRegion  = useRegionStore(s => s.updateRegion)
  const removeRegion  = useRegionStore(s => s.removeRegion)
  const clearSel      = useRegionStore(s => s.clearSelection)

  const region = regions.find(r => r.id === selectedId)

  if (!region) {
    return (
      <div className="panel-section" style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.6 }}>
        Switch to <strong style={{ color: 'var(--accent-warn)' }}>Select [S]</strong> mode
        and click a region (painted area) to inspect it.
        <br /><br />
        Click a single precise neuron to open the Neuron Inspector.
      </div>
    )
  }

  const count = region.positions.length / 3

  const toggleChem = (field, name) => {
    const cur  = region[field]
    const next = cur.includes(name) ? cur.filter(c => c !== name) : [...cur, name]
    updateRegion(region.id, { [field]: next })
  }

  return (
    <div className="panel-scroll">
      {/* Header */}
      <div className="panel-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
            {region.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            {count.toLocaleString()} neurons
          </div>
        </div>
        <button className="ns-btn icon-only" onClick={clearSel} title="Deselect">✕</button>
      </div>

      {/* Name */}
      <div className="panel-section">
        <Field label="Region Name">
          <input
            className="ns-input"
            type="text"
            value={region.name}
            onChange={e => updateRegion(region.id, { name: e.target.value })}
          />
        </Field>

        <Field label="Morphology">
          <select
            className="ns-select"
            value={region.morphology}
            onChange={e => updateRegion(region.id, { morphology: e.target.value })}
          >
            {MORPHOLOGY_NAMES.map(m => (
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5, lineHeight: 1.4 }}>
            {MORPHOLOGY_DEFAULTS[region.morphology]?.description}
          </div>
        </Field>
      </div>

      {/* Growth */}
      <div className="panel-section">
        <div className="panel-label">Growth</div>
        <div className="ns-input-row">
          <div>
            <div className="ns-label">Branch prob.</div>
            <input className="ns-input" type="number" step="0.005" min={0} max={1}
              value={region.branch_prob}
              onChange={e => updateRegion(region.id, { branch_prob: Number(e.target.value) })} />
          </div>
          <div>
            <div className="ns-label">Max branch len.</div>
            <input className="ns-input" type="number" step="1" min={1} max={200}
              value={region.max_branch_len}
              onChange={e => updateRegion(region.id, { max_branch_len: Number(e.target.value) })} />
          </div>
        </div>
        <Field label="Neurites / neuron">
          <input className="ns-input" type="number" step="1" min={1} max={8}
            value={region.neuriteCount}
            onChange={e => updateRegion(region.id, { neuriteCount: Number(e.target.value) })} />
        </Field>
      </div>

      {/* Chemicals */}
      <div className="panel-section">
        <div className="panel-label">Chemicals</div>
        <ChemTagList label="Releases" values={region.releases}
          color="var(--accent-chem)"
          onAdd={n => updateRegion(region.id, { releases: [...region.releases, n] })}
          onRemove={n => toggleChem('releases', n)} />
        <ChemTagList label="Attracts" values={region.attracts}
          color="var(--accent-axon)"
          onAdd={n => updateRegion(region.id, { attracts: [...region.attracts, n] })}
          onRemove={n => toggleChem('attracts', n)} />
        <ChemTagList label="Repels" values={region.repels}
          color="var(--accent-dend)"
          onAdd={n => updateRegion(region.id, { repels: [...region.repels, n] })}
          onRemove={n => toggleChem('repels', n)} />
      </div>

      {/* Promote hint */}
      <div className="panel-section">
        <PromoteHint />
      </div>

      {/* Danger */}
      <div className="panel-section">
        <button className="ns-btn danger" style={{ width: '100%' }}
          onClick={() => { removeRegion(region.id); clearSel() }}>
          Delete Region ({count.toLocaleString()} neurons)
        </button>
      </div>
    </div>
  )
}
