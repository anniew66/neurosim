// components/canvas/CanvasHUD.jsx
// Viewport overlay: stats, magnification control, hints.

import useSceneStore    from '../../store/useSceneStore.js'
import useRegionStore   from '../../store/useRegionStore.js'
import useBrushStore    from '../../store/useBrushStore.js'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import useDisplayStore  from '../../store/useDisplayStore.js'
import { SURFACE_PRESETS }  from '../../lib/surfaceMath.js'

const MODE_SYMBOLS = {
  point:   '·',
  area:    '■',
  carve:   '○',
  promote: '↑',
  erase:   '×',
  select:  '◇',
  chemical:'◈',
}

export default function CanvasHUD() {
  const neurons     = useSceneStore(s => s.neurons)
  const bulkCount   = useRegionStore(s => s.totalCount())
  const cursorPos   = useBrushStore(s => s.cursorPos)
  const mode        = useBrushStore(s => s.mode)
  const surfaceType = usePaintSurfaceStore(s => s.surfaceType)
  const displayMag  = useDisplayStore(s => s.displayMagnification)
  const setDisplayMag = useDisplayStore(s => s.setDisplayMagnification)
  const surfaceDef  = SURFACE_PRESETS[surfaceType]

  const totalNeurons = neurons.length + bulkCount

  return (
    <>
      {/* Bottom-centre status bar */}
      <div className="canvas-hud" style={{ pointerEvents: 'none' }}>
        <span style={{ color: 'var(--text-dim)' }}>{MODE_SYMBOLS[mode] ?? '·'}</span>
        <span style={{ color: 'var(--text-dim)', margin: '0 2px' }}>|</span>
        <span>neurons</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {totalNeurons.toLocaleString()}
        </span>
        <span style={{ color: 'var(--text-dim)', margin: '0 2px' }}>|</span>
        <span>surface</span>
        <span style={{ color: 'var(--text-primary)' }}>
          {surfaceDef?.label ?? surfaceType}
        </span>
        {cursorPos && (
          <>
            <span style={{ color: 'var(--text-dim)', margin: '0 2px' }}>|</span>
            <span>
              {cursorPos[0].toFixed(3)},&nbsp;
              {cursorPos[1].toFixed(3)},&nbsp;
              {cursorPos[2].toFixed(3)}&nbsp;mm
            </span>
          </>
        )}
      </div>

      {/* Top-right: magnification control */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
        padding: '6px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        boxShadow: 'var(--shadow-sm)',
        zIndex: 5,
      }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Display ×
        </span>
        <input type="range" className="ns-slider"
          min={0} max={1} step={0.001}
          value={Math.log10(displayMag) / Math.log10(200)}
          onChange={e => {
            const frac = Number(e.target.value)
            setDisplayMag(Math.pow(10, frac * Math.log10(200)))
          }}
          style={{ width: 90, pointerEvents: 'all' }}
        />
        <input
          type="number"
          className="ns-input"
          value={displayMag.toFixed(1)}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v) && v > 0) setDisplayMag(v)
          }}
          style={{ width: 54, pointerEvents: 'all', fontSize: 11, textAlign: 'right' }}
        />
      </div>

      {/* Top-left: key hints */}
      <div style={{
        position: 'absolute', top: 10, left: 10,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
        padding: '5px 9px',
        fontSize: 10, fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)', lineHeight: 1.9,
        pointerEvents: 'none',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>LMB</span> paint
          &nbsp;&nbsp;
          <span style={{ color: 'var(--text-secondary)' }}>Shift+LMB</span> ctrl point
        </div>
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>RMB/MMB</span> orbit
          &nbsp;&nbsp;
          <span style={{ color: 'var(--text-secondary)' }}>P A C O E S</span> brush
        </div>
      </div>
    </>
  )
}
