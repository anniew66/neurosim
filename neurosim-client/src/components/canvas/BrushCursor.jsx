// components/canvas/BrushCursor.jsx
// Translucent sphere following the brush cursor on the paint surface.
// Orients to the surface normal at the cursor position.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useBrushStore        from '../../store/useBrushStore.js'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import { evalNormal }       from '../../lib/surfaceMath.js'

const MODE_COLORS = {
  point:   new THREE.Color('#4fc3f7'),
  area:    new THREE.Color('#4fc3f7'),
  chemical:new THREE.Color('#00e5a0'),
  carve:   new THREE.Color('#e53935'),
  promote: new THREE.Color('#ffb300'),
  erase:   new THREE.Color('#e53935'),
  select:  new THREE.Color('#ffb300'),
}

const UP = new THREE.Vector3(0, 1, 0)
const _quat = new THREE.Quaternion()
const _norm = new THREE.Vector3()

export default function BrushCursor() {
  const outerRef = useRef()
  const innerRef = useRef()
  const discRef  = useRef()

  const mode        = useBrushStore(s => s.mode)
  const brushRadius = useBrushStore(s => s.brushRadius)
  const cursorPos   = useBrushStore(s => s.cursorPos)
  const isPainting  = useBrushStore(s => s.isPainting)

  const surfaceType   = usePaintSurfaceStore(s => s.surfaceType)
  const params        = usePaintSurfaceStore(s => s.params)
  const controlPoints = usePaintSurfaceStore(s => s.controlPoints)

  useFrame(({ clock }) => {
    const visible = !!cursorPos
    ;[outerRef, innerRef, discRef].forEach(r => {
      if (r.current) r.current.visible = visible
    })
    if (!visible) return

    const [x, y, z] = cursorPos
    const color = MODE_COLORS[mode] ?? MODE_COLORS.area
    const t     = clock.getElapsedTime()
    const pulse = isPainting ? 0.92 + 0.08 * Math.sin(t * 12) : 1.0

    // Surface normal for orientation
    const [nx, ny, nz] = evalNormal(x, z, surfaceType, params, controlPoints)
    _norm.set(nx, ny, nz)
    _quat.setFromUnitVectors(UP, _norm)

    for (const ref of [outerRef, innerRef, discRef]) {
      if (!ref.current) continue
      ref.current.position.set(x, y, z)
      ref.current.quaternion.copy(_quat)
    }

    if (outerRef.current) {
      outerRef.current.scale.setScalar(brushRadius * pulse)
      outerRef.current.material.color.copy(color)
    }
    if (innerRef.current) {
      innerRef.current.scale.setScalar(brushRadius * pulse * 0.3)
      innerRef.current.material.color.copy(color)
    }
    if (discRef.current) {
      discRef.current.scale.setScalar(brushRadius * pulse)
      discRef.current.material.color.copy(color)
    }
  })

  return (
    <>
      <mesh ref={outerRef}>
        <sphereGeometry args={[1, 20, 16]} />
        <meshBasicMaterial transparent opacity={0.07} side={THREE.BackSide}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={innerRef}>
        <sphereGeometry args={[1, 14, 12]} />
        <meshBasicMaterial transparent opacity={0.22}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* Flat disc aligned to surface normal */}
      <mesh ref={discRef}>
        <ringGeometry args={[0.92, 1, 48]} />
        <meshBasicMaterial transparent opacity={0.55} side={THREE.DoubleSide}
          depthWrite={false} />
      </mesh>
    </>
  )
}
