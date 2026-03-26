// components/canvas/SceneCanvas.jsx
// Brush routing for all six modes.
// After each committed action, pushes an undo entry to useHistoryStore.
// Pan: middle-mouse drag. Orbit: right-mouse drag. Scroll: zoom.

import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useRef, useCallback, useEffect } from 'react'
import * as THREE from 'three'

import SceneGrid     from './Grid.jsx'
import NeuronCloud   from './NeuronCloud.jsx'
import RegionCloud   from './RegionCloud.jsx'
import ChemicalField from './ChemicalField.jsx'
import BrushCursor   from './BrushCursor.jsx'
import PaintSurface        from './PaintSurface.jsx'
import DensityCloud        from './DensityCloud.jsx'

import useBrushStore        from '../../store/useBrushStore.js'
import useSceneStore        from '../../store/useSceneStore.js'
import useRegionStore       from '../../store/useRegionStore.js'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import useHistoryStore       from '../../store/useHistoryStore.js'
import useTissueDensityStore from '../../store/useTissueDensityStore.js'
import { getDefaults }      from '../../lib/neuronDefaults.js'
import { raySurfaceIntersect, evalHeight } from '../../lib/surfaceMath.js'

// ── Sphere sampling ───────────────────────────────────────────────────────────
const SPHERE_VOL = r => (4 / 3) * Math.PI * r ** 3

function sampleSphere(cx, cy, cz, radius, density, jitter) {
  const count = Math.max(1, Math.round(SPHERE_VOL(radius) * density))
  const pts   = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let dx, dy, dz
    do {
      dx = (Math.random() * 2 - 1) * radius
      dy = (Math.random() * 2 - 1) * radius
      dz = (Math.random() * 2 - 1) * radius
    } while (dx*dx + dy*dy + dz*dz > radius*radius)
    pts[i*3]   = cx + dx * jitter
    pts[i*3+1] = cy + dy * jitter
    pts[i*3+2] = cz + dz * jitter
  }
  return pts
}

function concatF32(a, b) {
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0); out.set(b, a.length)
  return out
}

// ── Inner scene ───────────────────────────────────────────────────────────────
function SceneInner() {
  const { camera, gl, raycaster, pointer } = useThree()
  const orbitRef = useRef()

  const mode          = useBrushStore(s => s.mode)
  const setCursorPos  = useBrushStore(s => s.setCursorPos)
  const setIsPainting = useBrushStore(s => s.setIsPainting)

  const addNeurons    = useSceneStore(s => s.addNeurons)
  const addChemicals  = useSceneStore(s => s.addChemicals)
  const eraseAt       = useSceneStore(s => s.eraseAt)
  const addRegion     = useRegionStore(s => s.addRegion)
  const carveAt       = useRegionStore(s => s.carveAt)
  const promoteAt     = useRegionStore(s => s.promoteAt)
  const pushHistory   = useHistoryStore(s => s.push)
  const addControlPoint = usePaintSurfaceStore(s => s.addControlPoint)

  const strokeBuffer          = useRef(new Float32Array(0))
  const lastDabPos            = useRef(null)
  const densityStrokeSnapshot = useRef(null)   // grid snapshot taken at stroke start
  const brushRef     = useRef({})
  const surfaceRef   = useRef({})

  // Keep stable refs so event handlers always see current values
  useEffect(() => {
    const unsub = useBrushStore.subscribe(s => {
      brushRef.current = {
        mode: s.mode, brushRadius: s.brushRadius, density: s.density,
        jitterAmount: s.jitterAmount, morphology: s.morphology,
        neuriteCount: s.neuriteCount, chemical: s.chemical,
        brushChems: s.brushChems, brushChemsUseDefaults: s.brushChemsUseDefaults,
        brushIsInput: s.brushIsInput ?? false,
        brushStartTime: s.brushStartTime ?? 0,
      }
    })
    const s = useBrushStore.getState()
    brushRef.current = {
      mode: s.mode, brushRadius: s.brushRadius, density: s.density,
      jitterAmount: s.jitterAmount, morphology: s.morphology,
      neuriteCount: s.neuriteCount, chemical: s.chemical,
    }
    return unsub
  }, [])

  useEffect(() => {
    const unsub = usePaintSurfaceStore.subscribe(s => {
      surfaceRef.current = { surfaceType: s.surfaceType, params: s.params, controlPoints: s.controlPoints }
    })
    const s = usePaintSurfaceStore.getState()
    surfaceRef.current = { surfaceType: s.surfaceType, params: s.params, controlPoints: s.controlPoints }
    return unsub
  }, [])

  // ── Surface raycast ─────────────────────────────────────────────────────────
  // All brush modes — including density — use the same parametric surface.
  // Falls back to a horizontal plane at y=0 if the surface ray misses.
  const solveSurface = useCallback(() => {
    raycaster.setFromCamera(pointer, camera)
    const { origin, direction } = raycaster.ray
    const { surfaceType, params, controlPoints } = surfaceRef.current

    const result = raySurfaceIntersect(
      origin.x, origin.y, origin.z,
      direction.x, direction.y, direction.z,
      surfaceType, params, controlPoints,
    )
    if (result) return result.point

    // Fallback: flat horizontal plane at y=0
    if (Math.abs(direction.y) > 1e-6) {
      const t = -origin.y / direction.y
      if (t > 0) return [
        origin.x + t * direction.x,
        0,
        origin.z + t * direction.z,
      ]
    }
    return null
  }, [camera, raycaster, pointer])

  useFrame(() => {
    const hit = solveSurface()
    setCursorPos(hit ?? null)
  })

  // ── Apply one dab + record undo ───────────────────────────────────────────
  function applyDab(point, b, shiftKey) {
    const [cx, cy, cz] = point
    const { surfaceType, params, controlPoints } = surfaceRef.current

    if (shiftKey && surfaceType === 'custom') {
addControlPoint(cx, cz, cy - (params.offsetY ?? 0))
      return
    }

    switch (b.mode) {
      case 'area': {
        // Accumulate only — commit on pointerup
        const pts = sampleSphere(cx, cy, cz, b.brushRadius, b.density, b.jitterAmount)
        strokeBuffer.current = concatF32(strokeBuffer.current, pts)
        break
      }

      case 'point': {
        const defaults = getDefaults(b.morphology)
        const useDefChems = b.brushChemsUseDefaults ?? true
        const neuron = {
          id: crypto.randomUUID(), soma: [cx, cy, cz],
          morphology:     b.morphology,
          soma_radius:    defaults.soma_radius,
          releases: useDefChems ? [...defaults.releases] : [...(b.brushChems?.releases ?? [])],
          attracts: useDefChems ? [...defaults.attracts] : [...(b.brushChems?.attracts ?? [])],
          repels:   useDefChems ? [...defaults.repels]   : [...(b.brushChems?.repels   ?? [])],
          branch_prob:    defaults.branch_prob,
          max_branch_len: defaults.max_branch_length,
          neurites:   [],
          is_input:   b.brushIsInput   ?? false,
          start_time: b.brushStartTime ?? 0,
          input_mode:           'rate',
          input_rate:           0.1,
          input_sequence:       [],
          input_emit_chemicals: false,
        }
        addNeurons([neuron])
        pushHistory({ type: 'ADD_PRECISE', neuronIds: [neuron.id] })
        break
      }

      case 'chemical': {
        const chem = {
          id: crypto.randomUUID(), name: b.chemical.name, source: [cx, cy, cz],
          sigma: b.chemical.sigma, strength: b.chemical.strength,
        }
        addChemicals([chem])
        pushHistory({ type: 'ADD_CHEMICALS', chemIds: [chem.id] })
        break
      }

      case 'erase': {
        const { deletedNeurons, deletedChemicals } = eraseAt([cx, cy, cz], b.brushRadius)
        const patches = carveAt(cx, cy, cz, b.brushRadius)
        const actions = []
        if (deletedNeurons.length)   actions.push({ type: 'REMOVE_PRECISE',   neurons: deletedNeurons })
        if (deletedChemicals.length) actions.push({ type: 'REMOVE_CHEMICALS', chemicals: deletedChemicals })
        if (patches.length)          actions.push({ type: 'CARVE_REGIONS',    patches })
        if (actions.length === 1) pushHistory(actions[0])
        else if (actions.length > 1) pushHistory({ type: 'COMPOSITE', actions })
        break
      }

      case 'carve': {
        const patches = carveAt(cx, cy, cz, b.brushRadius)
        if (patches.length > 0) pushHistory({ type: 'CARVE_REGIONS', patches })
        break
      }

      case 'promote': {
        const { neurons, patches } = promoteAt(cx, cy, cz, b.brushRadius)
        if (neurons.length > 0) {
          addNeurons(neurons)
          pushHistory({ type: 'PROMOTE', neuronIds: neurons.map(n => n.id), patches })
        }
        break
      }

      case 'density': {
        // Paint or erase density depending on brushDensity sign
        const densStore = useTissueDensityStore.getState()
        densStore.paint(cx, cy, cz, b.brushRadius)
        break
      }

      default: break
    }
  }

  // ── Pointer events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = gl.domElement

    const onDown = (e) => {
      if (e.button !== 0) return
      const b = brushRef.current
      if (b.mode !== 'select') {
        if (orbitRef.current) orbitRef.current.enabled = false
      }
      setIsPainting(true)
      strokeBuffer.current = new Float32Array(0)
      lastDabPos.current   = null
      // Snapshot density grid before any paint so we can undo the whole stroke
      if (b.mode === 'density') {
        densityStrokeSnapshot.current = useTissueDensityStore.getState().snapshotGrid()
      } else {
        densityStrokeSnapshot.current = null
      }
      const hit = solveSurface()
      if (hit) applyDab(hit, b, e.shiftKey)
    }

    const onMove = (e) => {
      if (!useBrushStore.getState().isPainting) return
      const b   = brushRef.current
      const hit = solveSurface()
      if (!hit) return
      // Density brush: no distance gate — paint continuously as cursor moves
      if (b.mode !== 'density') {
        if (lastDabPos.current) {
          const dx = hit[0] - lastDabPos.current[0]
          const dz = hit[2] - lastDabPos.current[2]
          if (dx*dx + dz*dz < b.brushRadius * b.brushRadius * 0.15) return
        }
      }
      lastDabPos.current = [...hit]
      applyDab(hit, b, e.shiftKey)
    }

    const onUp = () => {
      setIsPainting(false)
      if (orbitRef.current) orbitRef.current.enabled = true

      const b = brushRef.current

      // Commit density stroke undo — compare snapshot to detect actual change
      if (b.mode === 'density' && densityStrokeSnapshot.current !== null) {
        const before = densityStrokeSnapshot.current
        const after  = useTissueDensityStore.getState().data
        // Only push if at least one cell changed
        let changed = false
        for (let i = 0; i < before.length; i++) {
          if (before[i] !== after[i]) { changed = true; break }
        }
        if (changed) pushHistory({ type: 'DENSITY_STROKE', before })
        densityStrokeSnapshot.current = null
      }

      if (b.mode === 'area' && strokeBuffer.current.length >= 3) {
        const positions = strokeBuffer.current
        const useDefChems2 = b.brushChemsUseDefaults ?? true
        addRegion(positions, {
          morphology:   b.morphology,
          neuriteCount: b.neuriteCount,
          releases: useDefChems2 ? null : [...(b.brushChems?.releases ?? [])],
          attracts: useDefChems2 ? null : [...(b.brushChems?.attracts ?? [])],
          repels:   useDefChems2 ? null : [...(b.brushChems?.repels   ?? [])],
          is_input:             b.brushIsInput   ?? false,
          start_time:           b.brushStartTime ?? 0,
          input_mode:           'rate',
          input_rate:           0.1,
          input_sequence:       [],
          input_emit_chemicals: false,
        })
        // Get the ID of the just-added region (last one in the store)
        const regions = useRegionStore.getState().regions
        const newRegion = regions[regions.length - 1]
        if (newRegion) pushHistory({ type: 'ADD_REGION', regionId: newRegion.id })
        strokeBuffer.current = new Float32Array(0)
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, solveSurface])

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[8, 12, 6]}  intensity={1.2} castShadow />
      <directionalLight position={[-6, 4, -8]} intensity={0.3} color="#4a90d9" />

      <SceneGrid />
      <PaintSurface />
      <NeuronCloud />
      <RegionCloud />
      <DensityCloud />
      <ChemicalField />
      <BrushCursor />

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxDistance={200}
        minDistance={0.0001}
        enablePan
        panSpeed={1.2}
        mouseButtons={{
          LEFT:   mode === 'select' ? THREE.MOUSE.ROTATE : undefined,
          MIDDLE: THREE.MOUSE.PAN,    // middle-mouse drag = pan
          RIGHT:  THREE.MOUSE.ROTATE, // right-mouse drag = orbit
        }}
      />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#c0392b', '#38a169', '#2b6cb0']} labelColor="#f0f0f0" />
      </GizmoHelper>
    </>
  )
}

export default function SceneCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0.5, 1.0], fov: 50, near: 0.00001, far: 500 }}
      gl={{ antialias: true, alpha: false }}
      shadows
      style={{ background: '#1c1c1c' }}
      onPointerMissed={() => {
        // Click on empty space in select mode clears all selections
        if (useBrushStore.getState().mode === 'select') {
          useSceneStore.getState().clearSelection()
          useRegionStore.getState().selectRegion(null)
        }
      }}
    >
      <SceneInner />
    </Canvas>
  )
}
