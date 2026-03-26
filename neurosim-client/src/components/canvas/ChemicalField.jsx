// components/canvas/ChemicalField.jsx
// Renders chemical sources as glowing spheres. Always mounted (never returns null
// early) so refs are stable. Uses simple InstancedMesh spheres — no billboarding
// issues, works from any camera angle.

import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useSceneStore from '../../store/useSceneStore.js'
import { CHEMICAL_COLORS } from '../../lib/neuronDefaults.js'

const MAX_CHEMS = 200
const dummy = new THREE.Object3D()
const _col  = new THREE.Color()

export default function ChemicalField() {
  const chemicals = useSceneStore(s => s.chemicals)
  const coreRef   = useRef()
  const haloRef   = useRef()

  // Update instance data whenever chemicals list changes
  useEffect(() => {
    const core = coreRef.current
    const halo = haloRef.current
    if (!core || !halo) return
    const n = Math.min(chemicals.length, MAX_CHEMS)
    for (let i = 0; i < n; i++) {
      const ch = chemicals[i]
      _col.set(CHEMICAL_COLORS[ch.name] ?? CHEMICAL_COLORS.default)
      dummy.position.set(ch.source[0], ch.source[1], ch.source[2])

      // Core: small sphere, radius proportional to sigma
      dummy.scale.setScalar(Math.max(0.08, ch.sigma * 0.04))
      dummy.updateMatrix()
      core.setMatrixAt(i, dummy.matrix)
      core.setColorAt(i, _col)

      // Halo: large transparent sphere
      dummy.scale.setScalar(Math.max(0.4, ch.sigma * 0.25))
      dummy.updateMatrix()
      halo.setMatrixAt(i, dummy.matrix)
      halo.setColorAt(i, _col)
    }
    core.count = n; halo.count = n
    core.instanceMatrix.needsUpdate = true
    halo.instanceMatrix.needsUpdate = true
    if (core.instanceColor) core.instanceColor.needsUpdate = true
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true
  }, [chemicals])

  // Pulse core each frame
  useFrame(({ clock }) => {
    const core = coreRef.current
    if (!core || core.count === 0) return
    const t = clock.getElapsedTime()
    for (let i = 0; i < core.count; i++) {
      const ch = chemicals[i]
      if (!ch) continue
      const pulse = 0.88 + 0.12 * Math.sin(t * 1.5 + i * 1.1)
      dummy.position.set(ch.source[0], ch.source[1], ch.source[2])
      dummy.scale.setScalar(Math.max(0.08, ch.sigma * 0.04) * pulse)
      dummy.updateMatrix()
      core.setMatrixAt(i, dummy.matrix)
    }
    core.instanceMatrix.needsUpdate = true
  })

  // Always render — never early-return null — so refs stay stable
  return (
    <group>
      {/* Halo: large soft glow */}
      <instancedMesh ref={haloRef} args={[null, null, MAX_CHEMS]}
                     frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial
          transparent depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.08} vertexColors
        />
      </instancedMesh>

      {/* Core: bright centre */}
      <instancedMesh ref={coreRef} args={[null, null, MAX_CHEMS]}
                     frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial
          transparent depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.9} vertexColors
        />
      </instancedMesh>
    </group>
  )
}
