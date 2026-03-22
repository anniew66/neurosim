// store/useSceneStore.js
// Central state for the 3D scene: neurons, chemical sources, selection.
// All mutations go through actions here so components stay declarative.

import { create } from 'zustand'
import { eraseInRadius, eraseChemicalsInRadius } from '../lib/brushEngine.js'
import { applyPreset } from '../lib/presets.js'
import { getDefaults, makeNeurite } from '../lib/neuronDefaults.js'

const useSceneStore = create((set, get) => ({
  // ── Scene data ─────────────────────────────────────────────────────────────
  neurons:   [],   // NeuronRecord[]
  chemicals: [],   // ChemSource[] = { id, name, source:[x,y,z], sigma, strength }

  // ── Selection ──────────────────────────────────────────────────────────────
  selectedNeuronId: null,

  // ── Actions: neurons ────────────────────────────────────────────────────────
  addNeurons(newNeurons) {
    set(s => ({ neurons: [...s.neurons, ...newNeurons] }))
  },

  removeNeuronsByIds(ids) {
    const idSet = new Set(ids)
    set(s => ({ neurons: s.neurons.filter(n => !idSet.has(n.id)) }))
  },

  eraseAt(center, radius) {
    const { neurons, chemicals } = get()
    const deadNeurons = eraseInRadius(neurons, center, radius)
    const deadChems   = eraseChemicalsInRadius(chemicals, center, radius)
    const deadNSet    = new Set(deadNeurons)
    const deadCSet    = new Set(deadChems)
    set({
      neurons:   neurons.filter(n => !deadNSet.has(n.id)),
      chemicals: chemicals.filter(c => !deadCSet.has(c.id)),
    })
  },

  updateNeuron(id, patch) {
    set(s => ({
      neurons: s.neurons.map(n => n.id === id ? { ...n, ...patch } : n)
    }))
  },

  /** Change a neuron's morphology and re-apply defaults for unoverridden fields. */
  changeMorphology(id, morphology) {
    const defaults = getDefaults(morphology)
    set(s => ({
      neurons: s.neurons.map(n => n.id !== id ? n : {
        ...n,
        morphology,
        releases:       defaults.releases,
        attracts:       defaults.attracts,
        repels:         defaults.repels,
        branch_prob:    defaults.branch_prob,
        max_branch_len: defaults.max_branch_length,
      })
    }))
  },

  addNeurite(neuronId) {
    set(s => ({
      neurons: s.neurons.map(n => n.id !== neuronId ? n : {
        ...n,
        neurites: [...n.neurites, makeNeurite(Math.random() * 360, 0)],
      })
    }))
  },

  removeNeurite(neuronId, index) {
    set(s => ({
      neurons: s.neurons.map(n => {
        if (n.id !== neuronId || n.neurites.length <= 1) return n
        const neurites = n.neurites.filter((_, i) => i !== index)
        return { ...n, neurites }
      })
    }))
  },

  updateNeurite(neuronId, index, patch) {
    set(s => ({
      neurons: s.neurons.map(n => {
        if (n.id !== neuronId) return n
        const neurites = n.neurites.map((nt, i) => i === index ? { ...nt, ...patch } : nt)
        return { ...n, neurites }
      })
    }))
  },

  // ── Actions: chemicals ───────────────────────────────────────────────────────
  addChemicals(newChems) {
    const stamped = newChems.map(c => ({ ...c, id: c.id ?? crypto.randomUUID() }))
    set(s => ({ chemicals: [...s.chemicals, ...stamped] }))
  },

  updateChemical(id, patch) {
    set(s => ({
      chemicals: s.chemicals.map(c => c.id === id ? { ...c, ...patch } : c)
    }))
  },

  removeChemical(id) {
    set(s => ({ chemicals: s.chemicals.filter(c => c.id !== id) }))
  },

  // ── Actions: presets ─────────────────────────────────────────────────────────
  stampPreset(presetId, cx, cy, cz, scale = 1) {
    const { neurons, chemicals } = applyPreset(presetId, cx, cy, cz, scale)
    const stampedChems = chemicals.map(c => ({ ...c, id: crypto.randomUUID() }))
    set(s => ({
      neurons:   [...s.neurons, ...neurons],
      chemicals: [...s.chemicals, ...stampedChems],
    }))
  },

  // ── Actions: selection ───────────────────────────────────────────────────────
  selectNeuron(id) { set({ selectedNeuronId: id }) },
  clearSelection()  { set({ selectedNeuronId: null }) },

  // ── Actions: scene ───────────────────────────────────────────────────────────
  clearScene() { set({ neurons: [], chemicals: [], selectedNeuronId: null }) },

  /** Export a plain object ready to JSON.stringify and send to Julia. */
  exportScene() {
    const { neurons, chemicals } = get()
    return { neurons, chemicals }
  },
}))

export default useSceneStore
