// components/canvas/RegionCloud.jsx
// Renders bulk neuron regions as InstancedMesh — one mesh per region.
// Each region is a single draw call regardless of how many neurons it contains.
// Re-builds instance matrices only when region positions actually change.

import { useRef, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import useRegionStore from '../../store/useRegionStore.js'
import useBrushStore  from '../../store/useBrushStore.js'
import { MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

const SOMA_RADIUS   = 0.25   // bulk neurons slightly smaller than precise ones
const SELECTED_EMISSIVE = new THREE.Color('#ffb300')
const DUMMY = new THREE.Object3D()

// ── Single region mesh ────────────────────────────────────────────────────────
function RegionMesh({ region, isSelected, onClick }) {
  const meshRef  = useRef()
  const count    = region.positions.length / 3

  const baseColor = useMemo(() => {
    const def = MORPHOLOGY_DEFAULTS[region.morphology] ?? MORPHOLOGY_DEFAULTS.generic
    return new THREE.Color(def.color)
  }, [region.morphology])

  // Rebuild instance matrices whenever positions change
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || count === 0) return

    for (let i = 0; i < count; i++) {
      DUMMY.position.set(
        region.positions[i*3],
        region.positions[i*3+1],
        region.positions[i*3+2],
      )
      DUMMY.updateMatrix()
      mesh.setMatrixAt(i, DUMMY.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    // Color: uniform per region (can vary per-instance later if needed)
    const col = isSelected ? SELECTED_EMISSIVE : baseColor
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, col)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [region.positions, count, isSelected, baseColor])

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, count]}
      onClick={e => {
        e.stopPropagation()
        onClick(region.id)
      }}
      frustumCulled={false}
    >
      <sphereGeometry args={[SOMA_RADIUS, 8, 6]} />
      <meshStandardMaterial
        roughness={0.45}
        metalness={0.1}
        emissive={isSelected ? SELECTED_EMISSIVE : new THREE.Color(0, 0, 0)}
        emissiveIntensity={isSelected ? 0.3 : 0}
      />
    </instancedMesh>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function RegionCloud() {
  const regions         = useRegionStore(s => s.regions)
  const selectedId      = useRegionStore(s => s.selectedRegionId)
  const selectRegion    = useRegionStore(s => s.selectRegion)
  const mode            = useBrushStore(s => s.mode)

  if (regions.length === 0) return null

  return (
    <group>
      {regions.map(r => (
        <RegionMesh
          key={r.id}
          region={r}
          isSelected={r.id === selectedId}
          onClick={id => {
            if (mode === 'select') selectRegion(id)
          }}
        />
      ))}
    </group>
  )
}
