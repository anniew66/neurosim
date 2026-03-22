// components/canvas/SceneCanvas.jsx
// R3F canvas. Brush routing for all six modes.
// Paint plane replaced with parametric surface — raycasting uses bisection.
// Shift+Click places RBF control points (custom surface mode).

import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useRef, useCallback, useEffect } from 'react'
import * as THREE from 'three'

import SceneGrid     from './Grid.jsx'
import NeuronCloud   from './NeuronCloud.jsx'
import RegionCloud   from './RegionCloud.jsx'
import ChemicalField from './ChemicalField.jsx'
import BrushCursor   from './BrushCursor.jsx'
import PaintSurface  from './PaintSurface.jsx'

import useBrushStore        from '../../store/useBrushStore.js'
import useSceneStore        from '../../store/useSceneStore.js'
import useRegionStore       from '../../store/useRegionStore.js'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import { getDefaults }      from '../../lib/neuronDefaults.js'
import { raySurfaceIntersect, evalHeight, evalNormal } from '../../lib/surfaceMath.js'

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

  // Brush
  const mode         = useBrushStore(s => s.mode)
  const brushRadius  = useBrushStore(s => s.brushRadius)
  const setCursorPos = useBrushStore(s => s.setCursorPos)
  const setIsPainting = useBrushStore(s => s.setIsPainting)

  // Scene actions
  const addNeurons   = useSceneStore(s => s.addNeurons)
  const addChemicals = useSceneStore(s => s.addChemicals)
  const eraseAt      = useSceneStore(s => s.eraseAt)
  const addRegion    = useRegionStore(s => s.addRegion)
  const carveAt      = useRegionStore(s => s.carveAt)
  const promoteAt    = useRegionStore(s => s.promoteAt)

  // Surface
  const addControlPoint = usePaintSurfaceStore(s => s.addControlPoint)

  // Stroke buffer for area brush
  const strokeBuffer = useRef(new Float32Array(0))
  const lastDabPos   = useRef(null)

  // Stable ref for brush settings
  const brushRef   = useRef({})
  const surfaceRef = useRef({})

  useEffect(() => {
    const unsub = useBrushStore.subscribe(s => {
      brushRef.current = {
        mode: s.mode, brushRadius: s.brushRadius, density: s.density,
        jitterAmount: s.jitterAmount, morphology: s.morphology,
        neuriteCount: s.neuriteCount, chemical: s.chemical,
      }
    })
    brushRef.current = {
      mode, brushRadius,
      density:      useBrushStore.getState().density,
      jitterAmount: useBrushStore.getState().jitterAmount,
      morphology:   useBrushStore.getState().morphology,
      neuriteCount: useBrushStore.getState().neuriteCount,
      chemical:     useBrushStore.getState().chemical,
    }
    return unsub
  }, [])

  useEffect(() => {
    const unsub = usePaintSurfaceStore.subscribe(s => {
      surfaceRef.current = {
        surfaceType:   s.surfaceType,
        params:        s.params,
        controlPoints: s.controlPoints,
      }
    })
    const s = usePaintSurfaceStore.getState()
    surfaceRef.current = { surfaceType: s.surfaceType, params: s.params, controlPoints: s.controlPoints }
    return unsub
  }, [])

  // ── Surface raycast ─────────────────────────────────────────────────────────
  const solveSurface = useCallback(() => {
    raycaster.setFromCamera(pointer, camera)
    const { origin, direction } = raycaster.ray
    const { surfaceType, params, controlPoints } = surfaceRef.current

    const result = raySurfaceIntersect(
      origin.x,    origin.y,    origin.z,
      direction.x, direction.y, direction.z,
      surfaceType, params, controlPoints,
    )
    return result ? result.point : null
  }, [camera, raycaster, pointer])

  // ── Track cursor every frame ────────────────────────────────────────────────
  useFrame(() => {
    const hit = solveSurface()
    setCursorPos(hit ?? null)
  })

  // ── Apply one dab ───────────────────────────────────────────────────────────
  function applyDab(point, b, shiftKey) {
    const [cx, cy, cz] = point
    const { surfaceType, params, controlPoints } = surfaceRef.current

    // Shift+click places RBF control point (custom surface only)
    if (shiftKey && surfaceType === 'custom') {
      const baseY = evalHeight(cx, cz, 'flat', params, [])
      addControlPoint(cx, cz, cy - (params.offsetY ?? 0))
      return
    }

    switch (b.mode) {
      case 'area': {
        const pts = sampleSphere(cx, cy, cz, b.brushRadius, b.density, b.jitterAmount)
        strokeBuffer.current = concatF32(strokeBuffer.current, pts)
        break
      }
      case 'point': {
        const defaults = getDefaults(b.morphology)
        addNeurons([{
          id: crypto.randomUUID(), soma: [cx, cy, cz],
          morphology: b.morphology,
          releases:   [...defaults.releases],
          attracts:   [...defaults.attracts],
          repels:     [...defaults.repels],
          branch_prob:    defaults.branch_prob,
          max_branch_len: defaults.max_branch_length,
          neurites: Array.from({ length: Math.max(1, b.neuriteCount) }, (_, i) => ({
            azimuth:   (i / Math.max(1, b.neuriteCount)) * 360,
            elevation: (Math.random() - 0.5) * 60,
          })),
        }])
        break
      }
      case 'chemical':
        addChemicals([{
          id: crypto.randomUUID(), name: b.chemical.name, source: [cx, cy, cz],
          sigma: b.chemical.sigma, strength: b.chemical.strength,
        }])
        break
      case 'erase':
        eraseAt([cx, cy, cz], b.brushRadius)
        carveAt(cx, cy, cz, b.brushRadius)
        break
      case 'carve':
        carveAt(cx, cy, cz, b.brushRadius)
        break
      case 'promote': {
        const neurons = promoteAt(cx, cy, cz, b.brushRadius)
        if (neurons.length > 0) addNeurons(neurons)
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

      const hit = solveSurface()
      if (hit) applyDab(hit, b, e.shiftKey)
    }

    const onMove = (e) => {
      if (!useBrushStore.getState().isPainting) return
      const b   = brushRef.current
      const hit = solveSurface()
      if (!hit) return

      if (lastDabPos.current) {
        const dx = hit[0] - lastDabPos.current[0]
        const dz = hit[2] - lastDabPos.current[2]
        const minD2 = b.brushRadius * b.brushRadius * 0.15
        if (dx*dx + dz*dz < minD2) return
      }
      lastDabPos.current = [...hit]
      applyDab(hit, b, e.shiftKey)
    }

    const onUp = () => {
      setIsPainting(false)
      if (orbitRef.current) orbitRef.current.enabled = true

      const b = brushRef.current
      if (b.mode === 'area' && strokeBuffer.current.length >= 3) {
        addRegion(strokeBuffer.current, {
          morphology:   b.morphology,
          neuriteCount: b.neuriteCount,
          releases: null, attracts: null, repels: null,
        })
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
      <directionalLight position={[-6, 4, -8]} intensity={0.3} color="#4fc3f7" />

      <SceneGrid />
      <PaintSurface />
      <NeuronCloud />
      <RegionCloud />
      <ChemicalField />
      <BrushCursor />

      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.08}
        maxDistance={120} minDistance={1}
        mouseButtons={{
          LEFT:   mode === 'select' ? THREE.MOUSE.ROTATE : undefined,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT:  THREE.MOUSE.ROTATE,
        }}
      />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e53935', '#00e5a0', '#2979ff']} labelColor="#e8f0f8" />
      </GizmoHelper>
    </>
  )
}

export default function SceneCanvas() {
  return (
    <Canvas camera={{ position: [0, 14, 20], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true, alpha: false }} shadows style={{ background: '#080c10' }}>
      <fog attach="fog" args={['#080c10', 60, 160]} />
      <SceneInner />
    </Canvas>
  )
}
