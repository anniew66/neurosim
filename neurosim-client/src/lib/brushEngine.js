// lib/brushEngine.js
// Converts brush strokes in 3D space into neuron placements and chemical sources.
// The brush operates on a world-space sphere of radius `brushRadius`.
// Density controls the expected number of neurons per unit³ of brush volume.

import { makeNeurite, getDefaults } from './neuronDefaults.js'

const SPHERE_VOLUME = (r) => (4 / 3) * Math.PI * r ** 3

/**
 * Given a brush stroke event (center, radius, settings), return an array of
 * new neuron records to add to the scene.
 *
 * @param {[number,number,number]} center - world position of brush center
 * @param {object} brushSettings
 *   .mode           - 'neuron' | 'chemical' | 'erase'
 *   .brushRadius    - world-space radius of the brush sphere
 *   .density        - neurons per unit³ (clamped; typical range 0.01–0.5)
 *   .morphology     - morphology key
 *   .jitterAmount   - random offset scale (0 = on center, 1 = edge of brush)
 *   .neuriteCount   - neurites per placed neuron (min 1)
 *   .releases       - string[] chemical names (override morphology defaults)
 *   .attracts       - string[]
 *   .repels         - string[]
 *   .chemical       - { name, sigma, strength } for chemical brush
 * @returns {{ neurons: NeuronRecord[], chemicals: ChemSource[] }}
 */
export function brushStroke(center, brushSettings) {
  const {
    mode = 'neuron',
    brushRadius = 1.5,
    density = 0.05,
    morphology = 'generic',
    jitterAmount = 0.8,
    neuriteCount = 1,
    releases, attracts, repels,
    chemical = null,
  } = brushSettings

  if (mode === 'chemical' && chemical) {
    return {
      neurons: [],
      chemicals: [{
        name:     chemical.name,
        source:   [...center],
        sigma:    chemical.sigma ?? brushRadius * 2,
        strength: chemical.strength ?? 1.0,
      }],
    }
  }

  if (mode === 'neuron') {
    const volume   = SPHERE_VOLUME(brushRadius)
    const expected = Math.max(1, Math.round(volume * density))
    const defaults = getDefaults(morphology)

    const neurons = Array.from({ length: expected }, () => {
      // Uniform random point inside sphere (rejection method)
      let dx, dy, dz
      do {
        dx = (Math.random() * 2 - 1) * brushRadius
        dy = (Math.random() * 2 - 1) * brushRadius
        dz = (Math.random() * 2 - 1) * brushRadius
      } while (dx*dx + dy*dy + dz*dz > brushRadius*brushRadius)

      const scale = jitterAmount
      return {
        id:         crypto.randomUUID(),
        soma:       [
          center[0] + dx * scale,
          center[1] + dy * scale,
          center[2] + dz * scale,
        ],
        morphology,
        releases:   releases ?? [...defaults.releases],
        attracts:   attracts ?? [...defaults.attracts],
        repels:     repels   ?? [...defaults.repels],
        branch_prob:    defaults.branch_prob,
        max_branch_len: defaults.max_branch_length,
        neurites:   Array.from({ length: Math.max(1, neuriteCount) }, (_, i) =>
          makeNeurite(
            (i / Math.max(1, neuriteCount)) * 360,
            (Math.random() - 0.5) * 60,
          )
        ),
      }
    })

    return { neurons, chemicals: [] }
  }

  return { neurons: [], chemicals: [] }
}

/**
 * Given a center and radius, return the IDs of neurons that fall within the
 * erase sphere. Caller is responsible for removing them from the store.
 */
export function eraseInRadius(neurons, center, radius) {
  const r2 = radius * radius
  return neurons
    .filter(n => {
      const dx = n.soma[0] - center[0]
      const dy = n.soma[1] - center[1]
      const dz = n.soma[2] - center[2]
      return dx*dx + dy*dy + dz*dz <= r2
    })
    .map(n => n.id)
}

/**
 * Return IDs of chemicals whose source falls within the erase sphere.
 */
export function eraseChemicalsInRadius(chemicals, center, radius) {
  const r2 = radius * radius
  return chemicals
    .filter(c => {
      const dx = c.source[0] - center[0]
      const dy = c.source[1] - center[1]
      const dz = c.source[2] - center[2]
      return dx*dx + dy*dy + dz*dz <= r2
    })
    .map(c => c.id)
}
