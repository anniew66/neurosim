// components/ui/SurfacePanel.jsx

import SliderWithInput      from './SliderWithInput.jsx'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import { SURFACE_PRESETS }  from '../../lib/surfaceMath.js'

function BoolRow({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', marginBottom: 10 }}>
      <span className="ns-label" style={{ marginBottom: 0 }}>{label}</span>
      <button className="ns-btn" style={{
        padding: '3px 10px', fontSize: 11,
        borderColor: value ? 'var(--accent-axon)' : 'var(--border-mid)',
        color:       value ? 'var(--accent-axon)' : 'var(--text-dim)',
        background:  value ? 'rgba(41,121,255,0.1)' : 'transparent',
      }} onClick={() => onChange(!value)}>
        {value ? 'On' : 'Off'}
      </button>
    </div>
  )
}

function SurfaceTypeCard({ typeKey, def, isActive, onClick }) {
  return (
    <button onClick={() => onClick(typeKey)} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      width: '100%', padding: '8px 10px',
      background:   isActive ? 'var(--bg-active)' : 'var(--bg-elevated)',
      border:       `1px solid ${isActive ? 'var(--accent-axon)' : 'var(--border-dim)'}`,
      borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: 5,
      textAlign: 'left', transition: 'all 0.15s',
    }}>
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

// Map param keys to appropriate slider ranges and units (all in mm)
// Ranges calibrated for human nervous system scale (max extent ~1000 mm)
const PARAM_META = {
  offsetY:   { min: -500, max: 500,  unit: 'mm',  log: false },
  pitch:     { min: -89,  max: 89,   unit: '°',   log: false },
  roll:      { min: -89,  max: 89,   unit: '°',   log: false },
  radius:    { min: 0.001,max: 1000, unit: 'mm',  log: true  },
  curvature: { min: 0,    max: 0.5,  unit: '/mm²', log: false },
  amplitude: { min: 0,    max: 100,  unit: 'mm',  log: false },
  freqX:     { min: 0,    max: 5,    unit: '/mm', log: false },
  freqZ:     { min: 0,    max: 5,    unit: '/mm', log: false },
  phase:     { min: 0,    max: 6.28, unit: 'rad', log: false },
  slope:     { min: -1,   max: 1,    unit: 'mm/mm', log: false },
  smoothing: { min: 0.001,max: 100,  unit: 'mm',  log: true  },
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
        const meta = PARAM_META[key] ?? { min: spec.min, max: spec.max, unit: '', log: false }
        return (
          <SliderWithInput key={key}
            label={spec.label}
            value={params[key] ?? spec.default ?? 0}
            min={meta.min} max={meta.max}
            unit={meta.unit} log={meta.log}
            onChange={v => setParam(key, v)}
          />
        )
      })}
    </>
  )
}

function CustomControlPoints() {
  const controlPoints = usePaintSurfaceStore(s => s.controlPoints)
  const updateCP      = usePaintSurfaceStore(s => s.updateControlPoint)
  const removeCP      = usePaintSurfaceStore(s => s.removeControlPoint)
  const clearCPs      = usePaintSurfaceStore(s => s.clearControlPoints)

  return (
    <div>
      <div style={{
        background: 'rgba(255,179,0,0.07)', border: '1px solid rgba(255,179,0,0.2)',
        borderRadius: 'var(--radius-md)', padding: '8px 10px',
        fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10,
      }}>
        <strong style={{ color: 'var(--accent-warn)' }}>Shift+Click</strong> in the
        viewport to place a control point. The surface bends through all points.
        Click a <span style={{ color: 'var(--accent-warn)' }}>gold sphere</span> to remove it.
      </div>

      {controlPoints.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center',
                      padding: '12px 0' }}>No control points yet.</div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {controlPoints.map((cp, i) => (
            <div key={cp.id} style={{
              display: 'grid', gridTemplateColumns: '20px 1fr 1fr 1fr 22px',
              gap: 4, alignItems: 'center', marginBottom: 6,
            }}>
              <span style={{ fontSize: 9, color: 'var(--text-dim)',
                             fontFamily: 'var(--font-mono)' }}>{i+1}</span>
              {[['X', 'x'], ['Z', 'z'], ['ΔY', 'dy']].map(([lbl, field]) => (
                <div key={field}>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 2 }}>
                    {lbl} <span style={{ color: 'var(--text-dim)', fontSize: 8 }}>mm</span>
                  </div>
                  <input className="ns-input" type="number" step="0.01"
                    value={Number(cp[field]).toFixed(3)}
                    onChange={e => updateCP(cp.id, { [field]: Number(e.target.value) })}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }} />
                </div>
              ))}
              <button className="ns-btn icon-only danger"
                style={{ fontSize: 10, padding: '4px' }}
                onClick={() => removeCP(cp.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {controlPoints.length > 0 && (
        <button className="ns-btn danger" style={{ width: '100%', fontSize: 11 }}
          onClick={clearCPs}>Clear All Points</button>
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
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 10 }}>
          <div className="panel-label" style={{ marginBottom: 0 }}>Paint Surface</div>
          <button className="ns-btn" style={{
            fontSize: 11, padding: '3px 10px',
            borderColor: showSurface ? 'var(--accent-chem)' : 'var(--border-dim)',
            color:       showSurface ? 'var(--accent-chem)' : 'var(--text-dim)',
          }} onClick={toggleSurface}>
            {showSurface ? 'Visible' : 'Hidden'}
          </button>
        </div>
        <SliderWithInput label="Opacity" value={surfaceOpacity}
          min={0.01} max={0.8} unit="%"
          onChange={setOpacity} format={v => `${Math.round(v * 100)}`} />
      </div>

      <div className="panel-section">
        <div className="panel-label">Surface Type</div>
        {Object.entries(SURFACE_PRESETS).map(([key, def]) => (
          <SurfaceTypeCard key={key} typeKey={key} def={def}
            isActive={surfaceType === key} onClick={setSurfaceType} />
        ))}
      </div>

      {surfaceType !== 'custom' && (
        <div className="panel-section">
          <div className="panel-label">
            Parameters
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 400,
                           marginLeft: 6 }}>all values in mm</span>
          </div>
          <ParamSliders surfaceType={surfaceType} params={params} />
        </div>
      )}

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
