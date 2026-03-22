// components/ui/SurfacePanel.jsx
// Left sidebar Surface tab.
// Shows: surface type cards, parameter sliders, opacity, custom control point list.

import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import useBrushStore        from '../../store/useBrushStore.js'
import { SURFACE_PRESETS }  from '../../lib/surfaceMath.js'

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

function BoolRow({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 10 }}>
      <span className="ns-label" style={{ marginBottom: 0 }}>{label}</span>
      <button
        className="ns-btn"
        style={{
          padding: '3px 10px',
          fontSize: 11,
          borderColor: value ? 'var(--accent-axon)' : 'var(--border-mid)',
          color:       value ? 'var(--accent-axon)' : 'var(--text-dim)',
          background:  value ? 'rgba(41,121,255,0.1)' : 'transparent',
        }}
        onClick={() => onChange(!value)}
      >
        {value ? 'On' : 'Off'}
      </button>
    </div>
  )
}

function SurfaceTypeCard({ typeKey, def, isActive, onClick }) {
  return (
    <button
      onClick={() => onClick(typeKey)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 10px',
        background:   isActive ? 'var(--bg-active)' : 'var(--bg-elevated)',
        border:       `1px solid ${isActive ? 'var(--accent-axon)' : 'var(--border-dim)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer', marginBottom: 5,
        textAlign: 'left', transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 18, width: 28, textAlign: 'center', flexShrink: 0,
                     color: isActive ? 'var(--accent-axon)' : 'var(--text-dim)' }}>
        {def.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600,
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {def.label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {def.description}
        </div>
      </div>
    </button>
  )
}

function ParamSliders({ surfaceType, params }) {
  const setParam = usePaintSurfaceStore(s => s.setParam)
  const def      = SURFACE_PRESETS[surfaceType]
  if (!def?.params) return null

  return (
    <>
      {Object.entries(def.params).map(([key, spec]) => {
        if (spec.type === 'bool') {
          return (
            <BoolRow key={key} label={spec.label}
              value={params[key] ?? spec.default ?? false}
              onChange={v => setParam(key, v)} />
          )
        }
        return (
          <SliderRow key={key} label={spec.label}
            value={params[key] ?? spec.default ?? 0}
            min={spec.min} max={spec.max} step={spec.step}
            onChange={v => setParam(key, v)}
            format={v => {
              if (spec.label.includes('°')) return `${v.toFixed(0)}°`
              if (Math.abs(spec.step) < 0.01) return v.toFixed(3)
              if (Math.abs(spec.step) < 0.1)  return v.toFixed(2)
              return v.toFixed(1)
            }}
          />
        )
      })}
    </>
  )
}

function CustomControlPoints() {
  const controlPoints    = usePaintSurfaceStore(s => s.controlPoints)
  const updateCP         = usePaintSurfaceStore(s => s.updateControlPoint)
  const removeCP         = usePaintSurfaceStore(s => s.removeControlPoint)
  const clearCPs         = usePaintSurfaceStore(s => s.clearControlPoints)

  return (
    <div>
      <div style={{
        background: 'rgba(255,179,0,0.07)',
        border: '1px solid rgba(255,179,0,0.2)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 10px',
        fontSize: 11,
        color: 'var(--text-secondary)',
        lineHeight: 1.6,
        marginBottom: 10,
      }}>
        <strong style={{ color: 'var(--accent-warn)' }}>Shift+Click</strong> in the viewport
        to place a control point on the flat base. The surface bends through all points.
        Click a <span style={{ color: 'var(--accent-warn)' }}>gold handle</span> to remove it.
      </div>

      {controlPoints.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: '12px 0' }}>
          No control points yet.
        </div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {controlPoints.map((cp, i) => (
            <div key={cp.id} style={{
              display: 'grid', gridTemplateColumns: '28px 1fr 1fr 24px',
              gap: 4, alignItems: 'center', marginBottom: 5,
            }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {i + 1}
              </span>
              <div>
                <div className="ns-label" style={{ marginBottom: 2 }}>X / Z</div>
                <div style={{ display: 'flex', gap: 3 }}>
                  <input className="ns-input" type="number" step="0.5"
                    value={cp.x.toFixed(1)}
                    onChange={e => updateCP(cp.id, { x: Number(e.target.value) })}
                    style={{ width: '100%' }} />
                  <input className="ns-input" type="number" step="0.5"
                    value={cp.z.toFixed(1)}
                    onChange={e => updateCP(cp.id, { z: Number(e.target.value) })}
                    style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="ns-label" style={{ marginBottom: 2 }}>ΔY</div>
                <input className="ns-input" type="number" step="0.5"
                  value={cp.dy.toFixed(1)}
                  onChange={e => updateCP(cp.id, { dy: Number(e.target.value) })}
                  style={{ width: '100%' }} />
              </div>
              <button className="ns-btn icon-only danger"
                style={{ fontSize: 10, padding: '4px' }}
                onClick={() => removeCP(cp.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {controlPoints.length > 0 && (
        <button className="ns-btn danger" style={{ width: '100%', fontSize: 11 }}
          onClick={clearCPs}>
          Clear All Points
        </button>
      )}
    </div>
  )
}

export default function SurfacePanel() {
  const surfaceType    = usePaintSurfaceStore(s => s.surfaceType)
  const params         = usePaintSurfaceStore(s => s.params)
  const showSurface    = usePaintSurfaceStore(s => s.showSurface)
  const surfaceOpacity = usePaintSurfaceStore(s => s.surfaceOpacity)
  const setSurfaceType = usePaintSurfaceStore(s => s.setSurfaceType)
  const toggleSurface  = usePaintSurfaceStore(s => s.toggleSurface)
  const setOpacity     = usePaintSurfaceStore(s => s.setSurfaceOpacity)

  return (
    <div className="panel-scroll">
      {/* Visibility */}
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: 10 }}>
          <div className="panel-label" style={{ marginBottom: 0 }}>Paint Surface</div>
          <button className="ns-btn" style={{
            fontSize: 11, padding: '3px 10px',
            borderColor: showSurface ? 'var(--accent-chem)' : 'var(--border-dim)',
            color:       showSurface ? 'var(--accent-chem)' : 'var(--text-dim)',
          }} onClick={toggleSurface}>
            {showSurface ? 'Visible' : 'Hidden'}
          </button>
        </div>

        <SliderRow label="Opacity" value={surfaceOpacity}
          min={0.02} max={0.6} step={0.01}
          onChange={setOpacity} format={v => `${Math.round(v * 100)}%`} />
      </div>

      {/* Surface type */}
      <div className="panel-section">
        <div className="panel-label">Surface Type</div>
        {Object.entries(SURFACE_PRESETS).map(([key, def]) => (
          <SurfaceTypeCard key={key} typeKey={key} def={def}
            isActive={surfaceType === key}
            onClick={setSurfaceType} />
        ))}
      </div>

      {/* Surface parameters */}
      {surfaceType !== 'custom' && (
        <div className="panel-section">
          <div className="panel-label">Parameters</div>
          <ParamSliders surfaceType={surfaceType} params={params} />
        </div>
      )}

      {/* Custom: base offset + smoothing + control points */}
      {surfaceType === 'custom' && (
        <>
          <div className="panel-section">
            <div className="panel-label">Base Settings</div>
            <ParamSliders surfaceType="custom" params={params} />
          </div>
          <div className="panel-section">
            <div className="panel-label">Control Points</div>
            <CustomControlPoints />
          </div>
        </>
      )}
    </div>
  )
}
