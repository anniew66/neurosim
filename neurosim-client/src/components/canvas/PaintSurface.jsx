// components/canvas/PaintSurface.jsx
// Renders the active paint surface as a semi-transparent mesh + wireframe.
// Rebuilds geometry whenever surface params or control points change.
// Control point handles (custom mode) are clickable to remove.

import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'
import { buildSurfaceMesh, evalHeight } from '../../lib/surfaceMath.js'

const SURFACE_COLOR = new THREE.Color('#2979ff')
const WIRE_COLOR    = new THREE.Color('#1a3a5c')
const CTRL_COLOR    = new THREE.Color('#ffb300')

function SurfaceMesh({ surfaceType, params, controlPoints, opacity }) {
  const meshRef = useRef()
  const wireRef = useRef()

  useEffect(() => {
    const { positions, indices } = buildSurfaceMesh(surfaceType, params, controlPoints, {
      size: 60, divisions: 52,
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    geo.computeVertexNormals()

    if (meshRef.current) { meshRef.current.geometry.dispose(); meshRef.current.geometry = geo }
    if (wireRef.current) { wireRef.current.geometry.dispose(); wireRef.current.geometry = geo }
  }, [surfaceType, JSON.stringify(params), JSON.stringify(controlPoints)])

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const pulse = opacity + 0.025 * Math.sin(clock.getElapsedTime() * 0.7)
    meshRef.current.material.opacity = Math.max(0, Math.min(1, pulse))
  })

  const geo = useMemo(() => new THREE.BufferGeometry(), [])

  return (
    <group>
      <mesh ref={meshRef} geometry={geo} renderOrder={0}>
        <meshStandardMaterial color={SURFACE_COLOR} transparent opacity={opacity}
          side={THREE.DoubleSide} depthWrite={false} roughness={0.8} metalness={0.1} />
      </mesh>
      <mesh ref={wireRef} geometry={geo} renderOrder={1}>
        <meshBasicMaterial color={WIRE_COLOR} transparent opacity={Math.min(1, opacity * 2.2)}
          wireframe depthWrite={false} />
      </mesh>
    </group>
  )
}

function ControlHandle({ cp, surfaceType, params, controlPoints, onRemove }) {
  const ref    = useRef()
  const worldY = evalHeight(cp.x, cp.z, surfaceType, params, controlPoints)

  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.position.y = worldY + cp.dy + 0.12 * Math.sin(clock.getElapsedTime() * 2.2 + cp.x)
  })

  return (
    <group position={[cp.x, worldY + cp.dy, cp.z]}>
      <mesh ref={ref} onClick={e => { e.stopPropagation(); onRemove(cp.id) }}
        title="Click to remove">
        <sphereGeometry args={[0.32, 10, 8]} />
        <meshStandardMaterial color={CTRL_COLOR} emissive={CTRL_COLOR} emissiveIntensity={0.5} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.04, 0.04, Math.abs(cp.dy) + 0.5, 5]} />
        <meshBasicMaterial color={CTRL_COLOR} transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

export default function PaintSurface() {
  const surfaceType   = usePaintSurfaceStore(s => s.surfaceType)
  const params        = usePaintSurfaceStore(s => s.params)
  const controlPoints = usePaintSurfaceStore(s => s.controlPoints)
  const showSurface   = usePaintSurfaceStore(s => s.showSurface)
  const opacity       = usePaintSurfaceStore(s => s.surfaceOpacity)
  const removeCP      = usePaintSurfaceStore(s => s.removeControlPoint)

  if (!showSurface) return null

  return (
    <group>
      <SurfaceMesh surfaceType={surfaceType} params={params}
        controlPoints={controlPoints} opacity={opacity} />
      {surfaceType === 'custom' && controlPoints.map(cp => (
        <ControlHandle key={cp.id} cp={cp} surfaceType={surfaceType}
          params={params} controlPoints={controlPoints} onRemove={removeCP} />
      ))}
    </group>
  )
}
