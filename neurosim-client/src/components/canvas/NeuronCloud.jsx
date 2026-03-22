// components/canvas/NeuronCloud.jsx
// Renders all neurons as instanced spheres for performance.
// Selected neuron gets an outline ring.
// Click in 'select' mode → selects the neuron.

import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Instances, Instance, Sphere } from '@react-three/drei'
import * as THREE from 'three'

import useSceneStore from '../../store/useSceneStore.js'
import useBrushStore from '../../store/useBrushStore.js'
import { MORPHOLOGY_DEFAULTS } from '../../lib/neuronDefaults.js'

const SOMA_RADIUS    = 0.3
const SELECTED_COLOR = new THREE.Color('#ffb300')

function NeuronInstance({ neuron, isSelected, onSelect }) {
  const ref  = useRef()
  const mode = useBrushStore(s => s.mode)

  const color = useMemo(() => {
    const def = MORPHOLOGY_DEFAULTS[neuron.morphology] ?? MORPHOLOGY_DEFAULTS.generic
    return new THREE.Color(def.color)
  }, [neuron.morphology])

  return (
    <Instance
      ref={ref}
      position={neuron.soma}
      scale={isSelected ? 1.35 : 1}
      color={isSelected ? SELECTED_COLOR : color}
      onClick={e => {
        if (mode !== 'select') return
        e.stopPropagation()
        onSelect(neuron.id)
      }}
    />
  )
}

export default function NeuronCloud() {
  const neurons         = useSceneStore(s => s.neurons)
  const selectedId      = useSceneStore(s => s.selectedNeuronId)
  const selectNeuron    = useSceneStore(s => s.selectNeuron)
  const clearSelection  = useSceneStore(s => s.clearSelection)
  const mode            = useBrushStore(s => s.mode)

  if (neurons.length === 0) return null

  return (
    <Instances
      limit={10000}
      frustumCulled={false}
    >
      <sphereGeometry args={[SOMA_RADIUS, 12, 10]} />
      <meshStandardMaterial
        roughness={0.3}
        metalness={0.15}
        envMapIntensity={0.4}
      />
      {neurons.map(n => (
        <NeuronInstance
          key={n.id}
          neuron={n}
          isSelected={n.id === selectedId}
          onSelect={selectNeuron}
        />
      ))}
    </Instances>
  )
}
