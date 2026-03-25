// components/canvas/NeuronCloud.jsx
// Renders precise neurons as instanced spheres.
// Physical size = soma_radius (mm) × displayMagnification.
// Selected neuron gets a highlight ring and scale boost.

import { useRef, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Instances, Instance } from '@react-three/drei'
import * as THREE from 'three'

import useSceneStore   from '../../store/useSceneStore.js'
import useBrushStore   from '../../store/useBrushStore.js'
import useDisplayStore from '../../store/useDisplayStore.js'
import { MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

const SEL_COLOR    = new THREE.Color('#c07b2a')  // amber — corporate warning/highlight
const SOMA_SEGS    = 12

function NeuronInstance({ neuron, isSelected, onSelect, displayMag, selectionScale }) {
  const color = useMemo(() => {
    const def = MORPHOLOGY_DEFAULTS[neuron.morphology] ?? MORPHOLOGY_DEFAULTS.generic
    return new THREE.Color(def.color)
  }, [neuron.morphology])

  // Physical radius in mm × display magnification
  const r    = (neuron.soma_radius ?? 0.010) * displayMag
  const scale = isSelected ? r * selectionScale : r

  return (
    <Instance
      position={neuron.soma}
      scale={scale}
      color={isSelected ? SEL_COLOR : color}
      onClick={e => {
        if (useBrushStore.getState().mode !== 'select') return
        e.stopPropagation()
        onSelect(neuron.id)
      }}
    />
  )
}

export default function NeuronCloud() {
  const neurons        = useSceneStore(s => s.neurons)
  const selectedId     = useSceneStore(s => s.selectedNeuronId)
  const selectNeuron   = useSceneStore(s => s.selectNeuron)
  const displayMag     = useDisplayStore(s => s.displayMagnification)
  const selectionScale = useDisplayStore(s => s.selectionScale)

  if (neurons.length === 0) return null

  return (
    <Instances limit={20000} frustumCulled={false}>
      {/* Unit sphere; scaled per-instance */}
      <sphereGeometry args={[1, SOMA_SEGS, 10]} />
      <meshStandardMaterial roughness={0.35} metalness={0.05} />
      {neurons.map(n => (
        <NeuronInstance
          key={n.id}
          neuron={n}
          isSelected={n.id === selectedId}
          onSelect={selectNeuron}
          displayMag={displayMag}
          selectionScale={selectionScale}
        />
      ))}
    </Instances>
  )
}
