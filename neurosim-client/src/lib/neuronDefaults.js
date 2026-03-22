// lib/neuronDefaults.js
// Mirrors MORPHOLOGY_DEFAULTS in neurosim.jl exactly.
// Any change here should be reflected in the Julia sim and vice versa.

export const MORPHOLOGY_DEFAULTS = {
  purkinje: {
    branch_prob: 0.04,
    max_branch_length: 40.0,
    releases: ['BDNF'],
    attracts: ['NT3'],
    repels:   ['Sema3A'],
    color: '#4fc3f7',
    description: 'Large, highly-branched inhibitory neuron of the cerebellar cortex.',
  },
  granule: {
    branch_prob: 0.01,
    max_branch_length: 20.0,
    releases: ['NT3'],
    attracts: ['BDNF'],
    repels:   [],
    color: '#00e5a0',
    description: 'Small, numerous excitatory cerebellar neurons.',
  },
  basket: {
    branch_prob: 0.02,
    max_branch_length: 25.0,
    releases: ['GABA'],
    attracts: ['BDNF'],
    repels:   ['Sema3A'],
    color: '#ffb300',
    description: 'Inhibitory interneuron targeting Purkinje cell bodies.',
  },
  stellate: {
    branch_prob: 0.02,
    max_branch_length: 22.0,
    releases: ['GABA'],
    attracts: ['BDNF'],
    repels:   [],
    color: '#ce93d8',
    description: 'Inhibitory interneuron in the outer molecular layer.',
  },
  golgi: {
    branch_prob: 0.02,
    max_branch_length: 30.0,
    releases: ['GABA'],
    attracts: ['NT3'],
    repels:   [],
    color: '#ef9a9a',
    description: 'Inhibitory interneuron of the granule cell layer.',
  },
  generic: {
    branch_prob: 0.02,
    max_branch_length: 30.0,
    releases: [],
    attracts: [],
    repels:   [],
    color: '#7a9ab5',
    description: 'Generic neuron with no morphology-specific defaults.',
  },
}

export const MORPHOLOGY_NAMES = Object.keys(MORPHOLOGY_DEFAULTS)

export const KNOWN_CHEMICALS = [
  { id: 'BDNF',   label: 'BDNF',   description: 'Brain-derived neurotrophic factor' },
  { id: 'NT3',    label: 'NT3',     description: 'Neurotrophin-3' },
  { id: 'Sema3A', label: 'Sema3A', description: 'Semaphorin 3A (repulsive)' },
  { id: 'GABA',   label: 'GABA',   description: 'γ-aminobutyric acid' },
  { id: 'Netrin', label: 'Netrin', description: 'Bifunctional axon guidance cue' },
]

export const CHEMICAL_COLORS = {
  BDNF:   '#4fc3f7',
  NT3:    '#00e5a0',
  Sema3A: '#ef5350',
  GABA:   '#ffb300',
  Netrin: '#ce93d8',
  default:'#ffffff',
}

/** Return defaults for a morphology, deep-cloned so mutations are safe. */
export function getDefaults(morphology = 'generic') {
  const d = MORPHOLOGY_DEFAULTS[morphology] ?? MORPHOLOGY_DEFAULTS.generic
  return {
    ...d,
    releases: [...d.releases],
    attracts: [...d.attracts],
    repels:   [...d.repels],
  }
}

/** Build one neurite spec at the given azimuth/elevation (degrees). */
export function makeNeurite(azimuth = 0, elevation = 0) {
  return { azimuth, elevation }
}

/** Build a new neuron record from a position and morphology. */
export function makeNeuron(position, morphology = 'generic', extraNeurites = []) {
  const defaults = getDefaults(morphology)
  return {
    id:         crypto.randomUUID(),
    soma:       [...position],
    morphology,
    releases:   defaults.releases,
    attracts:   defaults.attracts,
    repels:     defaults.repels,
    branch_prob:    defaults.branch_prob,
    max_branch_len: defaults.max_branch_length,
    neurites: [
      makeNeurite(0, 0),
      ...extraNeurites,
    ],
  }
}
