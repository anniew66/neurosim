// lib/presets.js
// Preset "paintings" of real neural structures.
// Each preset is a function(centerX, centerY, centerZ, scale) => { neurons, chemicals }
// matching the neurosim.jl JSON input format.
// New presets: add an entry to PRESETS array and implement the generator function.

import { makeNeurite, getDefaults } from './neuronDefaults.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid() { return crypto.randomUUID() }

function jitter(val, amount) { return val + (Math.random() - 0.5) * 2 * amount }

function gridPositions(cx, cy, cz, nx, ny, nz, spacing) {
  const positions = []
  for (let ix = 0; ix < nx; ix++)
  for (let iy = 0; iy < ny; iy++)
  for (let iz = 0; iz < nz; iz++) {
    positions.push([
      cx + (ix - (nx-1)/2) * spacing,
      cy + (iy - (ny-1)/2) * spacing,
      cz + (iz - (nz-1)/2) * spacing,
    ])
  }
  return positions
}

function randomNeurite(n = 1) {
  return Array.from({ length: n }, () => makeNeurite(
    Math.random() * 360,
    (Math.random() - 0.5) * 90,
  ))
}

function neuron(morphology, soma, extraNeurites = []) {
  const d = getDefaults(morphology)
  return {
    id:             uid(),
    soma,
    morphology,
    releases:       [...d.releases],
    attracts:       [...d.attracts],
    repels:         [...d.repels],
    branch_prob:    d.branch_prob,
    max_branch_len: d.max_branch_length,
    neurites:       [makeNeurite(0, 0), ...extraNeurites],
  }
}

// ── Preset definitions ───────────────────────────────────────────────────────

/**
 * Cerebellar cortex micro-column.
 * Purkinje cells in a sheet, granule cells below, basket cells flanking.
 */
function cerebellarColumn(cx, cy, cz, scale = 1) {
  const neurons = []
  const chemicals = []
  const sp = 1.8 * scale

  // Purkinje sheet (5 cells, flat in XZ)
  for (let i = -2; i <= 2; i++) {
    neurons.push(neuron('purkinje', [
      jitter(cx + i * sp, 0.2 * scale),
      jitter(cy + 2 * scale, 0.1 * scale),
      jitter(cz, 0.2 * scale),
    ], randomNeurite(3)))
  }

  // Granule cell layer below
  for (const pos of gridPositions(cx, cy - 1.5 * scale, cz, 4, 2, 2, sp * 0.8)) {
    neurons.push(neuron('granule', pos.map((v, i) => jitter(v, 0.15 * scale)), [makeNeurite(90, 80)]))
  }

  // Basket cells flanking the Purkinje sheet
  for (let i = -1; i <= 1; i++) {
    neurons.push(neuron('basket', [
      jitter(cx + i * sp * 1.8, 0.2 * scale),
      jitter(cy + 2.5 * scale, 0.15 * scale),
      jitter(cz + sp, 0.2 * scale),
    ], randomNeurite(2)))
  }

  // BDNF from the granule layer drives Purkinje growth
  chemicals.push({
    name: 'BDNF',
    source: [cx, cy - 1.5 * scale, cz],
    sigma:  4.0 * scale,
    strength: 1.2,
  })

  return { neurons, chemicals }
}

/**
 * Cortical layer — generic excitatory/inhibitory balance.
 * Two layers: excitatory (generic) on top, inhibitory (basket) below.
 */
function corticalLayer(cx, cy, cz, scale = 1) {
  const neurons = []
  const chemicals = []
  const sp = 1.5 * scale

  // Excitatory layer
  for (const pos of gridPositions(cx, cy + scale, cz, 4, 1, 3, sp)) {
    neurons.push(neuron('generic', pos.map(v => jitter(v, 0.2 * scale)), randomNeurite(2)))
  }

  // Inhibitory layer
  for (const pos of gridPositions(cx, cy - scale, cz, 3, 1, 2, sp * 1.2)) {
    neurons.push(neuron('basket', pos.map(v => jitter(v, 0.2 * scale)), randomNeurite(2)))
  }

  return { neurons, chemicals }
}

/**
 * Golgi circuit — granule + golgi feedback loop.
 */
function golgiCircuit(cx, cy, cz, scale = 1) {
  const neurons = []
  const chemicals = []
  const sp = 1.4 * scale

  for (const pos of gridPositions(cx, cy, cz, 3, 2, 3, sp)) {
    neurons.push(neuron('granule', pos.map(v => jitter(v, 0.1 * scale)), [makeNeurite(0, 80)]))
  }

  for (let i = -1; i <= 1; i++) {
    neurons.push(neuron('golgi', [
      jitter(cx + i * sp * 1.5, 0.2 * scale),
      jitter(cy + 1.5 * scale, 0.15 * scale),
      jitter(cz, 0.2 * scale),
    ], randomNeurite(3)))
  }

  chemicals.push({
    name: 'NT3',
    source: [cx, cy, cz],
    sigma: 3.0 * scale,
    strength: 1.0,
  })

  return { neurons, chemicals }
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id:          'cerebellar_column',
    name:        'Cerebellar Column',
    description: 'Purkinje sheet + granule + basket cells with BDNF gradient',
    icon:        '🧠',
    tags:        ['cerebellum', 'purkinje', 'granule'],
    generate:    cerebellarColumn,
  },
  {
    id:          'cortical_layer',
    name:        'Cortical Layer',
    description: 'Excitatory/inhibitory balance across two layers',
    icon:        '🔵',
    tags:        ['cortex', 'generic', 'basket'],
    generate:    corticalLayer,
  },
  {
    id:          'golgi_circuit',
    name:        'Golgi Circuit',
    description: 'Granule + Golgi feedback loop with NT3 gradient',
    icon:        '🔄',
    tags:        ['cerebellum', 'golgi', 'granule'],
    generate:    golgiCircuit,
  },
  // ── Add future presets here ──────────────────────────────────────────────
  // {
  //   id:       'hippocampal_ca1',
  //   name:     'Hippocampal CA1',
  //   generate: hippocampalCA1,
  //   ...
  // },
]

/**
 * Apply a preset at a world position.
 * Returns { neurons: NeuronRecord[], chemicals: ChemSource[] }
 */
export function applyPreset(presetId, cx, cy, cz, scale = 1) {
  const preset = PRESETS.find(p => p.id === presetId)
  if (!preset) throw new Error(`Unknown preset: ${presetId}`)
  return preset.generate(cx, cy, cz, scale)
}
