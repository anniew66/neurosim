// store/useRegionStore.js
// Bulk-painted neuron regions. Each region stores positions as a Float32Array
// ([x0,y0,z0, x1,y1,z1, ...]) so thousands of neurons cost only memory,
// not React reconciliation. One Zustand commit per brush stroke.

import { create } from 'zustand'
import { getDefaults } from '../lib/neuronDefaults.js'

let regionCounter = 1

function makeRegionName() {
  return `Region ${regionCounter++}`
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Indices (into positions/3) of points inside a sphere. */
function pointsInSphere(positions, cx, cy, cz, radius) {
  const r2  = radius * radius
  const out = []
  const n   = positions.length / 3
  for (let i = 0; i < n; i++) {
    const dx = positions[i*3]   - cx
    const dy = positions[i*3+1] - cy
    const dz = positions[i*3+2] - cz
    if (dx*dx + dy*dy + dz*dz <= r2) out.push(i)
  }
  return out
}

/** Remove indices from a Float32Array of xyz triplets. */
function removeIndices(positions, indices) {
  const remove = new Set(indices)
  const n      = positions.length / 3
  const kept   = []
  for (let i = 0; i < n; i++) {
    if (!remove.has(i)) {
      kept.push(positions[i*3], positions[i*3+1], positions[i*3+2])
    }
  }
  return new Float32Array(kept)
}

/** Extract positions at indices as a new Float32Array. */
function extractIndices(positions, indices) {
  const out = new Float32Array(indices.length * 3)
  indices.forEach((idx, i) => {
    out[i*3]   = positions[idx*3]
    out[i*3+1] = positions[idx*3+1]
    out[i*3+2] = positions[idx*3+2]
  })
  return out
}

// ── Store ─────────────────────────────────────────────────────────────────────

const useRegionStore = create((set, get) => ({
  regions: [],          // RegionRecord[]
  selectedRegionId: null,

  // ── Add a completed stroke as a new region ──────────────────────────────────
  // positions: Float32Array of xyz triplets accumulated during the drag
  addRegion(positions, brushSettings) {
    if (positions.length < 3) return   // need at least one point
    const defaults = getDefaults(brushSettings.morphology ?? 'generic')
    const region = {
      id:             crypto.randomUUID(),
      name:           makeRegionName(),
      positions,                                    // Float32Array, xyz triplets
      morphology:     brushSettings.morphology  ?? 'generic',
      releases:       brushSettings.releases    ?? [...defaults.releases],
      attracts:       brushSettings.attracts    ?? [...defaults.attracts],
      repels:         brushSettings.repels      ?? [...defaults.repels],
      branch_prob:    defaults.branch_prob,
      max_branch_len: defaults.max_branch_length,
      neuriteCount:   brushSettings.neuriteCount ?? 1,
      color:          defaults.color,
    }
    set(s => ({ regions: [...s.regions, region] }))
  },

  updateRegion(id, patch) {
    set(s => ({
      regions: s.regions.map(r => {
        if (r.id !== id) return r
        // If morphology changed, re-derive defaults for unset fields
        if (patch.morphology && patch.morphology !== r.morphology) {
          const d = getDefaults(patch.morphology)
          return {
            ...r, ...patch,
            releases:       patch.releases    ?? [...d.releases],
            attracts:       patch.attracts    ?? [...d.attracts],
            repels:         patch.repels      ?? [...d.repels],
            branch_prob:    patch.branch_prob ?? d.branch_prob,
            max_branch_len: patch.max_branch_len ?? d.max_branch_length,
            color:          d.color,
          }
        }
        return { ...r, ...patch }
      })
    }))
  },

  removeRegion(id) {
    set(s => ({
      regions: s.regions.filter(r => r.id !== id),
      selectedRegionId: s.selectedRegionId === id ? null : s.selectedRegionId,
    }))
  },

  // ── Carve: remove points inside sphere from all regions ────────────────────
  // Returns { removedCount } so the caller can give feedback.
  carveAt(cx, cy, cz, radius) {
    let removedCount = 0
    set(s => ({
      regions: s.regions
        .map(r => {
          const hits = pointsInSphere(r.positions, cx, cy, cz, radius)
          if (hits.length === 0) return r
          removedCount += hits.length
          const next = removeIndices(r.positions, hits)
          return { ...r, positions: next }
        })
        .filter(r => r.positions.length >= 3),   // drop empty regions
    }))
    return removedCount
  },

  // ── Promote: carve out a sub-sphere and return it as precise neurons ────────
  // Returns array of {soma, morphology, ...} records ready for useSceneStore.
  // Removes those points from their source region.
  promoteAt(cx, cy, cz, radius) {
    const promoted = []
    set(s => ({
      regions: s.regions
        .map(r => {
          const hits = pointsInSphere(r.positions, cx, cy, cz, radius)
          if (hits.length === 0) return r
          const extracted = extractIndices(r.positions, hits)
          const defaults  = getDefaults(r.morphology)
          for (let i = 0; i < extracted.length / 3; i++) {
            promoted.push({
              id:             crypto.randomUUID(),
              soma:           [extracted[i*3], extracted[i*3+1], extracted[i*3+2]],
              morphology:     r.morphology,
              releases:       [...r.releases],
              attracts:       [...r.attracts],
              repels:         [...r.repels],
              branch_prob:    r.branch_prob,
              max_branch_len: r.max_branch_len,
              neurites:       Array.from({ length: Math.max(1, r.neuriteCount) },
                                (_, i2) => ({
                                  azimuth:   (i2 / Math.max(1, r.neuriteCount)) * 360,
                                  elevation: (Math.random() - 0.5) * 60,
                                })),
            })
          }
          return { ...r, positions: removeIndices(r.positions, hits) }
        })
        .filter(r => r.positions.length >= 3),
    }))
    return promoted
  },

  // ── Selection ───────────────────────────────────────────────────────────────
  selectRegion(id)  { set({ selectedRegionId: id }) },
  clearSelection()  { set({ selectedRegionId: null }) },

  clearAll() {
    regionCounter = 1
    set({ regions: [], selectedRegionId: null })
  },

  // ── Export: expand all regions to full neuron records for Julia ─────────────
  // Called by simApi.js. Returns NeuronRecord[].
  exportAsNeurons() {
    const { regions } = get()
    const out = []
    for (const r of regions) {
      const n = r.positions.length / 3
      for (let i = 0; i < n; i++) {
        out.push({
          id:             crypto.randomUUID(),
          soma:           [r.positions[i*3], r.positions[i*3+1], r.positions[i*3+2]],
          morphology:     r.morphology,
          releases:       [...r.releases],
          attracts:       [...r.attracts],
          repels:         [...r.repels],
          branch_prob:    r.branch_prob,
          max_branch_len: r.max_branch_len,
          neurites:       Array.from({ length: Math.max(1, r.neuriteCount) },
                            (_, j) => ({
                              azimuth:   (j / Math.max(1, r.neuriteCount)) * 360,
                              elevation: (Math.random() - 0.5) * 60,
                            })),
        })
      }
    }
    return out
  },

  // Total neuron count across all regions
  totalCount() {
    return get().regions.reduce((s, r) => s + r.positions.length / 3, 0)
  },
}))

export default useRegionStore
