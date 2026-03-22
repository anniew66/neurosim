// components/canvas/CanvasHUD.jsx
// Minimal viewport overlay: neuron counts, cursor world position, active brush, hints.
// Paint plane Y control removed — now lives in the Surface panel (left sidebar).

import useSceneStore        from '../../store/useSceneStore.js'
import useRegionStore       from '../../store/useRegionStore.js'
import useBrushStore        from '../../store/useBrushStore.js'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import { SURFACE_PRESETS }  from '../../lib/surfaceMath.js'

const MODE_LABELS = {
  point:   { symbol: '·',  color: 'var(--brush-neuron)' },
  area:    { symbol: '⬤',  color: 'var(--brush-neuron)' },
  carve:   { symbol: '◌',  color: 'var(--brush-erase)'  },
  promote: { symbol: '↑',  color: 'var(--accent-warn)'  },
  erase:   { symbol: '✕',  color: 'var(--brush-erase)'  },
  select:  { symbol: '◎',  color: 'var(--accent-warn)'  },
  chemical:{ symbol: '◈',  color: 'var(--brush-chem)'   },
}

export default function CanvasHUD() {
  const neurons     = useSceneStore(s => s.neurons)
  const bulkCount   = useRegionStore(s => s.totalCount())
  const cursorPos   = useBrushStore(s => s.cursorPos)
  const mode        = useBrushStore(s => s.mode)
  const surfaceType = usePaintSurfaceStore(s => s.surfaceType)
  const modeInfo    = MODE_LABELS[mode] ?? MODE_LABELS.area
  const surfaceDef  = SURFACE_PRESETS[surfaceType]

  return (
    <>
      {/* Bottom center HUD */}
      <div className="canvas-hud" style={{ pointerEvents: 'none' }}>
        <span style={{ color: modeInfo.color, fontSize: 14 }}>{modeInfo.symbol}</span>
        <span style={{ color: 'var(--text-dim)' }}>·</span>
        <span style={{ color: 'var(--text-secondary)' }}>neurons</span>
        <span>{(neurons.length + bulkCount).toLocaleString()}</span>
        <span style={{ color: 'var(--text-dim)' }}>·</span>
        <span style={{ color: 'var(--text-secondary)' }}>surface</span>
        <span style={{ color: 'var(--accent-axon)' }}>
          {surfaceDef?.icon} {surfaceDef?.label}
        </span>
        {cursorPos && (
          <>
            <span style={{ color: 'var(--text-dim)' }}>·</span>
            <span style={{ color: 'var(--text-secondary)' }}>xyz</span>
            <span>
              {cursorPos[0].toFixed(1)}, {cursorPos[1].toFixed(1)}, {cursorPos[2].toFixed(1)}
            </span>
          </>
        )}
      </div>

      {/* Top-left hints */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(13,19,24,0.75)', backdropFilter: 'blur(6px)',
        border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-md)',
        padding: '6px 10px', fontSize: 10, fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)', lineHeight: 1.8, pointerEvents: 'none',
      }}>
        <div><span style={{ color: 'var(--text-secondary)' }}>LMB</span> paint</div>
        <div><span style={{ color: 'var(--text-secondary)' }}>Shift+LMB</span> place control point</div>
        <div><span style={{ color: 'var(--text-secondary)' }}>RMB / MMB</span> orbit</div>
        <div><span style={{ color: 'var(--text-secondary)' }}>P A C O E S</span> switch brush</div>
      </div>
    </>
  )
}
