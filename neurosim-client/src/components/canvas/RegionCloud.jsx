// components/canvas/RegionCloud.jsx
// Renders bulk neuron regions as InstancedMesh — one draw call per region.
// Physical size = morphology soma_radius (mm) × displayMagnification.

import { useRef, useEffect, useMemo } from 'react'
import * as THREE from 'three'

import useRegionStore  from '../../store/useRegionStore.js'
import useBrushStore   from '../../store/useBrushStore.js'
import useDisplayStore from '../../store/useDisplayStore.js'
import { MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

const SEL_COLOR = new THREE.Color('#c07b2a')
const DUMMY     = new THREE.Object3D()

function RegionMesh({ region, isSelected, onClick, displayMag, selectionScale }) {
  const meshRef = useRef()
  const count   = region.positions.length / 3

  const def        = MORPHOLOGY_DEFAULTS[region.morphology] ?? MORPHOLOGY_DEFAULTS.generic
  const baseColor  = useMemo(() => new THREE.Color(def.color), [def.color])
  const somaRadius = def.soma_radius ?? 0.010
  const r          = somaRadius * displayMag * (isSelected ? selectionScale : 1.0)

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || count === 0) return

    for (let i = 0; i < count; i++) {
      DUMMY.position.set(
        region.positions[i*3],
        region.positions[i*3+1],
        region.positions[i*3+2],
      )
      DUMMY.scale.setScalar(r)
      DUMMY.updateMatrix()
      mesh.setMatrixAt(i, DUMMY.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    const col = isSelected ? SEL_COLOR : baseColor
    for (let i = 0; i < count; i++) mesh.setColorAt(i, col)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [region.positions, count, r, isSelected, baseColor])

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, count]}
      onClick={e => { e.stopPropagation(); onClick(region.id) }}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial roughness={0.4} metalness={0.05} />
    </instancedMesh>
  )
}

export default function RegionCloud() {
  const regions        = useRegionStore(s => s.regions)
  const selectedId     = useRegionStore(s => s.selectedRegionId)
  const selectRegion   = useRegionStore(s => s.selectRegion)
  const mode           = useBrushStore(s => s.mode)
  const displayMag     = useDisplayStore(s => s.displayMagnification)
  const selectionScale = useDisplayStore(s => s.selectionScale)

  if (regions.length === 0) return null

  return (
    <group>
      {regions.map(r => (
        <RegionMesh
          key={r.id}
          region={r}
          isSelected={r.id === selectedId}
          onClick={id => { if (mode === 'select') selectRegion(id) }}
          displayMag={displayMag}
          selectionScale={selectionScale}
        />
      ))}
    </group>
  )
}
