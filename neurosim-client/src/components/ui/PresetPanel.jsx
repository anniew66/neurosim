// components/ui/PresetPanel.jsx
// Lists available neural structure presets.
// Clicking a preset stamps it at the current brush cursor position
// (or world origin if cursor is off-screen).

import { useState } from 'react'
import { PRESETS } from '../../lib/presets.js'
import useSceneStore  from '../../store/useSceneStore.js'
import useBrushStore  from '../../store/useBrushStore.js'

function PresetScaleControl({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span className="ns-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Stamp scale</span>
      <input
        type="range"
        className="ns-slider"
        min={0.2} max={4} step={0.1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-accent)', minWidth: 30 }}>
        ×{value.toFixed(1)}
      </span>
    </div>
  )
}

function TagBadge({ label }) {
  return (
    <span style={{
      fontSize: 9,
      padding: '1px 5px',
      borderRadius: 8,
      background: 'var(--bg-active)',
      color: 'var(--text-dim)',
      border: '1px solid var(--border-dim)',
      fontFamily: 'var(--font-mono)',
    }}>
      {label}
    </span>
  )
}

export default function PresetPanel() {
  const [scale, setScale]       = useState(1.0)
  const [lastStamped, setLast]  = useState(null)
  const stampPreset = useSceneStore(s => s.stampPreset)
  const cursorPos   = useBrushStore(s => s.cursorPos)

  function stamp(presetId) {
    const [cx, cy, cz] = cursorPos ?? [0, 0, 0]
    stampPreset(presetId, cx, cy, cz, scale)
    setLast(presetId)
    setTimeout(() => setLast(null), 1200)
  }

  return (
    <div className="panel-scroll">
      <div className="panel-section">
        <div className="panel-label">Neural Presets</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
          Stamps a pre-configured neural structure at the brush cursor position.
          Move your cursor into the viewport first.
        </div>
        <PresetScaleControl value={scale} onChange={setScale} />
      </div>

      <div className="panel-section" style={{ paddingTop: 4 }}>
        {PRESETS.map(p => (
          <button
            key={p.id}
            className="preset-card"
            style={{
              width: '100%',
              cursor: 'pointer',
              textAlign: 'left',
              border: lastStamped === p.id
                ? '1px solid var(--accent-chem)'
                : '1px solid var(--border-dim)',
              transition: 'all 0.2s',
            }}
            onClick={() => stamp(p.id)}
          >
            <div className="preset-icon">{p.icon}</div>
            <div className="preset-info">
              <div className="preset-name">{p.name}</div>
              <div className="preset-desc">{p.description}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                {p.tags.map(t => <TagBadge key={t} label={t} />)}
              </div>
            </div>
            {lastStamped === p.id && (
              <span style={{ fontSize: 16, color: 'var(--accent-chem)', marginLeft: 4 }}>✓</span>
            )}
          </button>
        ))}

        {/* Future presets placeholder */}
        <div style={{
          border: '1px dashed var(--border-dim)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 12px',
          textAlign: 'center',
          color: 'var(--text-dim)',
          fontSize: 11,
          marginTop: 4,
        }}>
          More presets coming —<br />
          hippocampal, cortical column, retina…
        </div>
      </div>
    </div>
  )
}
