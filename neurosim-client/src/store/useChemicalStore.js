// store/useChemicalStore.js
// Global registry of known chemicals.
// Seeded from KNOWN_CHEMICALS in neuronDefaults.js.
// Users can add custom chemicals with arbitrary names, which then appear
// in all attract/repel/release selectors and the chemical brush.

import { create } from 'zustand'
import { KNOWN_CHEMICALS } from '../lib/neuronDefaults.js'

const useChemicalStore = create((set, get) => ({
  // Full list of known chemicals — starts with bio-defined set
  chemicals: KNOWN_CHEMICALS.map(c => ({ ...c })),

  // Add a new custom chemical. No-op if id already exists (case-insensitive).
  addChemical({ id, label, description = '' }) {
    const normalized = id.trim()
    if (!normalized) return
    const exists = get().chemicals.some(
      c => c.id.toLowerCase() === normalized.toLowerCase()
    )
    if (exists) return
    set(s => ({
      chemicals: [...s.chemicals, {
        id:          normalized,
        label:       label?.trim() || normalized,
        description: description?.trim() || 'Custom chemical',
        custom:      true,
      }]
    }))
  },

  // Remove a chemical by id. Built-in chemicals can also be removed.
  removeChemical(id) {
    set(s => ({ chemicals: s.chemicals.filter(c => c.id !== id) }))
  },

  // Find a chemical record by id (returns undefined if not found)
  find(id) {
    return get().chemicals.find(c => c.id === id)
  },
}))

export default useChemicalStore
