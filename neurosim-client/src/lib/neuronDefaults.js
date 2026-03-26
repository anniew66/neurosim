// lib/neuronDefaults.js
// All spatial values in MILLIMETRES — mirrors MORPHOLOGY_DEFAULTS in neurosim.jl.
// Soma radii and neurite lengths are biologically grounded:
//   Granule (cerebellar): soma ~3.5 µm radius, parallel fibers up to ~4.5 mm
//   Purkinje:             soma ~32 µm radius,  dendrites ~0.4 mm, axon ~3 mm
//   Basket:               soma ~9 µm radius,   axon collaterals ~0.7 mm
//   Stellate:             soma ~6 µm radius,   local arbors ~0.35 mm
//   Golgi:                soma ~15 µm radius,  axon ~0.8 mm
//   Generic pyramidal:    soma ~10 µm radius,  apical dendrite ~1–5 mm

export const MORPHOLOGY_DEFAULTS = {
  purkinje: {
    branch_prob:      0.04,
    max_branch_length: 3.0,       // mm — axon to deep cerebellar nuclei
    soma_radius:      0.032,      // mm (32 µm)
    soma_radius_noise:0.006,      // ± noise
    releases: ['BDNF'],
    attracts: ['NT3'],
    repels:   ['Sema3A'],
    color: '#4fc3f7',
    description: 'Large cerebellar inhibitory neuron. Massive dendritic arbor, long axon.',
  },
  granule: {
    branch_prob:      0.01,
    max_branch_length: 4.5,       // mm — parallel fibers run the full folium width
    soma_radius:      0.0035,     // mm (3.5 µm)
    soma_radius_noise:0.0005,
    releases: ['NT3'],
    attracts: ['BDNF'],
    repels:   [],
    color: '#00e5a0',
    description: 'Tiny, numerous cerebellar excitatory neuron. Long parallel fiber axon.',
  },
  basket: {
    branch_prob:      0.02,
    max_branch_length: 0.7,       // mm
    soma_radius:      0.009,      // mm (9 µm)
    soma_radius_noise:0.001,
    releases: ['GABA'],
    attracts: ['BDNF'],
    repels:   ['Sema3A'],
    color: '#ffb300',
    description: 'Inhibitory interneuron. Axon wraps around Purkinje soma.',
  },
  stellate: {
    branch_prob:      0.02,
    max_branch_length: 0.35,      // mm
    soma_radius:      0.006,      // mm (6 µm)
    soma_radius_noise:0.0015,
    releases: ['GABA'],
    attracts: ['BDNF'],
    repels:   [],
    color: '#ce93d8',
    description: 'Small inhibitory interneuron of the outer molecular layer.',
  },
  golgi: {
    branch_prob:      0.02,
    max_branch_length: 0.8,       // mm
    soma_radius:      0.015,      // mm (15 µm)
    soma_radius_noise:0.003,
    releases: ['GABA'],
    attracts: ['NT3'],
    repels:   [],
    color: '#ef9a9a',
    description: 'Large inhibitory interneuron of the granule cell layer.',
  },
  generic: {
    branch_prob:      0.02,
    max_branch_length: 2.0,       // mm
    soma_radius:      0.010,      // mm (10 µm)
    soma_radius_noise:0.002,
    releases: [],
    attracts: [],
    repels:   [],
    color: '#7a9ab5',
    description: 'Generic neuron (pyramidal-like). No morphology-specific defaults.',
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

export function getDefaults(morphology = 'generic') {
  const d = MORPHOLOGY_DEFAULTS[morphology] ?? MORPHOLOGY_DEFAULTS.generic
  return {
    ...d,
    releases: [...d.releases],
    attracts: [...d.attracts],
    repels:   [...d.repels],
  }
}

export function makeNeurite(azimuth = 0, elevation = 0) {
  return { azimuth, elevation }
}

export function makeNeuron(position, morphology = 'generic') {
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
    soma_radius:    defaults.soma_radius,
    // Neurites sprout from gradients during simulation
    neurites: [],
    // Input / timing fields
    is_input:             false,
    start_time:           0,
    input_mode:           'rate',      // 'rate' | 'sequence'
    input_rate:           0.1,         // probability per ms step
    input_sequence:       [],          // binary array for sequence mode
    input_emit_chemicals: false,
  }
}
