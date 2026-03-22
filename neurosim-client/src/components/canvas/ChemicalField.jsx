// components/canvas/ChemicalField.jsx
// Renders chemical sources as glowing, pulsing spheres colored by chemical type.
// Uses additive blending for a volumetric light-bloom feel.

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useSceneStore from '../../store/useSceneStore.js'
import { CHEMICAL_COLORS } from '../../lib/neuronDefaults.js'

function ChemSphere({ chem }) {
  const ref   = useRef()
  const color = useMemo(() => new THREE.Color(CHEMICAL_COLORS[chem.name] ?? CHEMICAL_COLORS.default), [chem.name])
  const phase = useMemo(() => Math.random() * Math.PI * 2, [])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    const pulse = 0.85 + 0.15 * Math.sin(t * 1.5 + phase)
    ref.current.scale.setScalar(pulse)
  })

  const baseRadius = Math.max(0.15, chem.sigma * 0.08)

  return (
    <group position={chem.source}>
      {/* Core sphere */}
      <mesh ref={ref}>
        <sphereGeometry args={[baseRadius, 10, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.4}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </mesh>
      {/* Outer halo */}
      <mesh>
        <sphereGeometry args={[baseRadius * 2.5, 8, 6]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.07}
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* Point light for ambient glow */}
      <pointLight
        color={color}
        intensity={chem.strength * 1.5}
        distance={chem.sigma * 1.2}
        decay={2}
      />
    </group>
  )
}

export default function ChemicalField() {
  const chemicals = useSceneStore(s => s.chemicals)
  if (chemicals.length === 0) return null

  return (
    <group>
      {chemicals.map(c => (
        <ChemSphere key={c.id} chem={c} />
      ))}
    </group>
  )
}
