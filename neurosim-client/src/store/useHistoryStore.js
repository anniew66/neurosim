// store/useHistoryStore.js
// Undo stack. Each entry is a "reverse operation" describing exactly how
// to undo one user action. Actions are pushed by SceneCanvas after each
// dab/commit; undo pops the top and executes it.
//
// Action types:
//   ADD_PRECISE      — added precise neurons         → remove by IDs
//   REMOVE_PRECISE   — erased precise neurons        → re-add full objects
//   ADD_REGION       — painted a bulk region         → remove by ID
//   CARVE_REGIONS    — carved from one or more regions → restore positions
//   PROMOTE          — promoted bulk → precise       → remove precise IDs + restore region positions
//   ADD_CHEMICALS    — placed chemical source(s)     → remove by IDs
//   REMOVE_CHEMICALS — erased chemical source(s)     → re-add full objects
//   CLEAR            — cleared everything            → restore full state
//   COMPOSITE        — multiple sub-actions (erase = precise + chemicals + carve)
//   DENSITY_STROKE   — density brush stroke      → restore pre-stroke grid snapshot

import { create } from 'zustand'
import useSceneStore  from './useSceneStore.js'
import useRegionStore        from './useRegionStore.js'
import useTissueDensityStore from './useTissueDensityStore.js'
import useChemPaintStore     from './useChemPaintStore.js'

const MAX_HISTORY = 200   // cap memory usage

const useHistoryStore = create((set, get) => ({
  stack: [],       // array of undo entries, most recent last
  canUndo: false,

  // ── Push a new undo entry ────────────────────────────────────────────────
  push(entry) {
    set(s => {
      const next = [...s.stack, entry]
      if (next.length > MAX_HISTORY) next.shift()
      return { stack: next, canUndo: true }
    })
  },

  // ── Undo the most recent action ──────────────────────────────────────────
  undo() {
    const { stack } = get()
    if (stack.length === 0) return

    const entry = stack[stack.length - 1]
    set(s => ({
      stack:   s.stack.slice(0, -1),
      canUndo: s.stack.length > 1,
    }))

    executeUndo(entry)
  },

  clear() { set({ stack: [], canUndo: false }) },
}))

// ── Execute a single undo entry ───────────────────────────────────────────────
function executeUndo(entry) {
  const scene  = useSceneStore.getState()
  const region = useRegionStore.getState()

  switch (entry.type) {

    case 'ADD_PRECISE':
      scene.removeNeuronsByIds(entry.neuronIds)
      break

    case 'REMOVE_PRECISE':
      scene.addNeurons(entry.neurons)
      break

    case 'ADD_REGION':
      region.removeRegion(entry.regionId)
      break

    // Carve undo: restore removed position chunks back into their regions.
    // entry.patches = [{ regionId, restoredPositions: Float32Array }]
    case 'CARVE_REGIONS':
      region.restoreCarvePatches(entry.patches)
      break

    // Promote undo: remove the extracted precise neurons AND restore
    // the positions back to the source region.
    case 'PROMOTE':
      scene.removeNeuronsByIds(entry.neuronIds)
      region.restoreCarvePatches(entry.patches)
      break

    case 'ADD_CHEMICALS':
      entry.chemIds.forEach(id => scene.removeChemical(id))
      break

    case 'REMOVE_CHEMICALS':
      scene.addChemicals(entry.chemicals)
      break

    case 'CLEAR':
      scene.restoreState(entry.neurons, entry.chemicals)
      region.restoreState(entry.regions)
      break

    // Composite: run each sub-action in reverse order
    case 'COMPOSITE':
      for (let i = entry.actions.length - 1; i >= 0; i--) {
        executeUndo(entry.actions[i])
      }
      break

    // Density undo: restore strokes to their state before the stroke started.
    case 'DENSITY_STROKE':
      useTissueDensityStore.getState().restoreStrokes(entry.before)
      break

    // Chemical stroke undo: restore all channels to their state before the stroke.
    case 'CHEM_STROKE':
      useChemPaintStore.getState().restoreChannels(entry.before)
      break

    default:
      console.warn('useHistoryStore: unknown undo entry type', entry.type)
  }
}

export default useHistoryStore
