// lib/presets.js
// Preset minimal neural circuits — biologically representative cell-type arrangements.
// Coordinates are in mm, scaled to fit comfortably in the default 1mm sim box.
// Neurites are NOT pre-assigned — sprouting generates them from chemical gradients.

import { getDefaults } from './neuronDefaults.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return crypto.randomUUID() }
function jitter(val, amount) { return val + (Math.random() - 0.5) * 2 * amount }

// Build a neuron object without pre-assigned neurites.
// Sprouting generates neurites dynamically during simulation.
function neuron(morphology, soma) {
  const d = getDefaults(morphology)
  return {
    id:             uid(),
    soma:           soma.map(v => Number(v.toFixed(5))),
    morphology,
    releases:       [...d.releases],
    attracts:       [...d.attracts],
    repels:         [...d.repels],
    branch_prob:    d.branch_prob,
    max_branch_len: d.max_branch_length,
    neurites:       [],   // sprouting handles this
    is_input:             false,
    start_time:           0,
    input_mode:           'rate',
    input_rate:           0.1,
    input_sequence:       [],
    input_emit_chemicals: false,
  }
}

// ── Preset generators ─────────────────────────────────────────────────────────
// All coordinates relative to cx/cy/cz, scaled so scale=1 fits in a ~0.6mm span.
// Default spacing uses biological soma-radius multiples (soma-to-soma ~5–15× radius).

/**
 * Cerebellar micro-circuit.
 * 2 Purkinje cells (large, inhibitory projection neurons) in a sheet,
 * 4 granule cells below feeding parallel fibers upward,
 * 1 basket cell providing feed-forward inhibition to Purkinje.
 * BDNF from granule layer drives Purkinje dendritic growth downward.
 */
function cerebellarColumn(cx, cy, cz, scale = 1) {
  const neurons   = []
  const chemicals = []

  // Purkinje soma radius ~32µm → spacing ~5 radii = 0.16mm
  const sp = 0.16 * scale

  // 2 Purkinje cells in a row (the sheet)
  neurons.push(neuron('purkinje', [cx - sp*0.5, cy + sp, jitter(cz, 0.01*scale)]))
  neurons.push(neuron('purkinje', [cx + sp*0.5, cy + sp, jitter(cz, 0.01*scale)]))

  // 4 granule cells below — tiny, packed in a layer
  const grSp = 0.025 * scale  // granule soma ~3.5µm → spacing ~7 radii
  for (let i = -1; i <= 2; i++) {
    neurons.push(neuron('granule', [
      jitter(cx + i * grSp, 0.005 * scale),
      jitter(cy - sp * 0.6, 0.005 * scale),
      jitter(cz, 0.01 * scale),
    ]))
  }

  // 1 basket cell flanking, at Purkinje layer height
  neurons.push(neuron('basket', [
    jitter(cx + sp * 1.2, 0.01 * scale),
    jitter(cy + sp, 0.01 * scale),
    jitter(cz, 0.01 * scale),
  ]))

  // BDNF from granule layer drives Purkinje dendrites downward
  chemicals.push({ id: uid(), name: 'BDNF',
    source: [cx, cy - sp * 0.6, cz],
    sigma:  0.3 * scale, strength: 1.2 })

  return { neurons, chemicals }
}

/**
 * Cortical E/I pair.
 * 3 excitatory pyramidal-like (generic) neurons and 2 inhibitory (basket)
 * in a simple two-layer arrangement. Shows excitatory-inhibitory balance.
 */
function corticalLayer(cx, cy, cz, scale = 1) {
  const neurons   = []
  const chemicals = []
  const sp = 0.05 * scale   // generic soma ~10µm → spacing ~5 radii = 0.05mm

  // Excitatory layer (top)
  for (let i = -1; i <= 1; i++) {
    neurons.push(neuron('generic', [
      jitter(cx + i * sp, 0.008 * scale),
      jitter(cy + sp * 0.8, 0.008 * scale),
      jitter(cz, 0.008 * scale),
    ]))
  }

  // Inhibitory layer (bottom)
  for (let i = -0.5; i <= 0.5; i++) {
    neurons.push(neuron('basket', [
      jitter(cx + i * sp * 1.5, 0.008 * scale),
      jitter(cy - sp * 0.8, 0.008 * scale),
      jitter(cz, 0.008 * scale),
    ]))
  }

  // BDNF from bottom drives upward growth
  chemicals.push({ id: uid(), name: 'BDNF',
    source: [cx, cy - sp, cz],
    sigma: 0.2 * scale, strength: 1.0 })

  return { neurons, chemicals }
}

/**
 * Golgi feedback loop.
 * 4 granule cells and 2 Golgi cells forming a recurrent inhibitory circuit.
 * Granules excite Golgi; Golgi feeds back inhibition to granules.
 * NT3 gradient organises the layering.
 */
function golgiCircuit(cx, cy, cz, scale = 1) {
  const neurons   = []
  const chemicals = []

  const grSp  = 0.025 * scale
  const golSp = 0.08  * scale   // Golgi soma ~15µm → spacing ~5 radii

  // Granule cells in a tight cluster
  for (let i = -1; i <= 2; i++) {
    neurons.push(neuron('granule', [
      jitter(cx + i * grSp, 0.005 * scale),
      jitter(cy - golSp * 0.5, 0.005 * scale),
      jitter(cz, 0.008 * scale),
    ]))
  }

  // 2 Golgi cells above
  for (let i = -0.5; i <= 0.5; i++) {
    neurons.push(neuron('golgi', [
      jitter(cx + i * golSp, 0.01 * scale),
      jitter(cy + golSp * 0.6, 0.01 * scale),
      jitter(cz, 0.01 * scale),
    ]))
  }

  chemicals.push({ id: uid(), name: 'NT3',
    source: [cx, cy, cz],
    sigma: 0.25 * scale, strength: 1.0 })

  return { neurons, chemicals }
}

/**
 * Input → relay → output feedforward chain.
 * 1 input neuron (rate-coded), 2 relay (generic), 1 output (generic).
 * A simple 3-stage chain to demonstrate signal propagation.
 */
function feedforwardChain(cx, cy, cz, scale = 1) {
  const neurons   = []
  const chemicals = []
  const sp = 0.08 * scale

  // Input neuron
  const inp = neuron('generic', [cx - sp * 1.5, cy, cz])
  inp.is_input   = true
  inp.input_mode = 'rate'
  inp.input_rate = 0.15
  inp.input_emit_chemicals = true
  neurons.push(inp)

  // 2 relay neurons
  neurons.push(neuron('generic', [cx - sp * 0.3, jitter(cy, 0.01*scale), jitter(cz, 0.01*scale)]))
  neurons.push(neuron('generic', [cx + sp * 0.3, jitter(cy, 0.01*scale), jitter(cz, 0.01*scale)]))

  // Output neuron
  neurons.push(neuron('generic', [cx + sp * 1.5, cy, cz]))

  chemicals.push({ id: uid(), name: 'BDNF',
    source: [cx + sp * 1.5, cy, cz],
    sigma: 0.3 * scale, strength: 1.5 })

  return { neurons, chemicals }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id:          'cerebellar_column',
    name:        'Cerebellar Micro-circuit',
    description: '2 Purkinje + 4 granule + 1 basket. BDNF drives Purkinje dendrites toward granule layer.',
    icon:        '🧠',
    tags:        ['cerebellum', 'purkinje', 'granule', 'basket'],
    generate:    cerebellarColumn,
  },
  {
    id:          'cortical_layer',
    name:        'Cortical E/I Pair',
    description: '3 excitatory + 2 inhibitory neurons in a two-layer arrangement.',
    icon:        '🔵',
    tags:        ['cortex', 'excitatory', 'inhibitory'],
    generate:    corticalLayer,
  },
  {
    id:          'golgi_circuit',
    name:        'Golgi Feedback Loop',
    description: '4 granule + 2 Golgi cells. Recurrent inhibitory circuit with NT3 gradient.',
    icon:        '🔄',
    tags:        ['cerebellum', 'golgi', 'granule', 'feedback'],
    generate:    golgiCircuit,
  },
  {
    id:          'feedforward_chain',
    name:        'Feedforward Chain',
    description: 'Input → 2 relay → output. Simple 3-stage signal propagation with BDNF target gradient.',
    icon:        '➡️',
    tags:        ['feedforward', 'input', 'signal'],
    generate:    feedforwardChain,
  },
]

export function applyPreset(presetId, cx, cy, cz, scale = 1) {
  const preset = PRESETS.find(p => p.id === presetId)
  if (!preset) throw new Error(`Unknown preset: ${presetId}`)
  return preset.generate(cx, cy, cz, scale)
}
