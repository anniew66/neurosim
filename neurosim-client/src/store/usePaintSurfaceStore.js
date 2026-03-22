// store/usePaintSurfaceStore.js
// All state for the paint surface (the 3D surface the brush paints onto).

import { create } from 'zustand'
import { SURFACE_PRESETS } from '../lib/surfaceMath.js'

function defaultParams(type) {
  const def = SURFACE_PRESETS[type]
  if (!def) return {}
  const out = {}
  for (const [key, spec] of Object.entries(def.params ?? {})) {
    out[key] = spec.default ?? 0
  }
  return out
}

const usePaintSurfaceStore = create((set, get) => ({
  // ── Active surface ──────────────────────────────────────────────────────────
  surfaceType:    'flat',
  params:         defaultParams('flat'),

  // ── Custom surface control points ───────────────────────────────────────────
  // Each: { id, x, z, dy } where dy is height offset from base at (x,z).
  controlPoints:  [],

  // ── Visibility ──────────────────────────────────────────────────────────────
  showSurface:    true,
  surfaceOpacity: 0.18,

  // ── Actions ─────────────────────────────────────────────────────────────────
  setSurfaceType(type) {
    set({ surfaceType: type, params: defaultParams(type) })
  },

  setParam(key, value) {
    set(s => ({ params: { ...s.params, [key]: value } }))
  },

  toggleSurface() {
    set(s => ({ showSurface: !s.showSurface }))
  },

  setSurfaceOpacity(v) {
    set({ surfaceOpacity: v })
  },

  addControlPoint(x, z, dy) {
    set(s => ({
      controlPoints: [
        ...s.controlPoints,
        { id: crypto.randomUUID(), x, z, dy },
      ]
    }))
  },

  updateControlPoint(id, patch) {
    set(s => ({
      controlPoints: s.controlPoints.map(cp =>
        cp.id === id ? { ...cp, ...patch } : cp
      )
    }))
  },

  removeControlPoint(id) {
    set(s => ({
      controlPoints: s.controlPoints.filter(cp => cp.id !== id)
    }))
  },

  clearControlPoints() {
    set({ controlPoints: [] })
  },
}))

export default usePaintSurfaceStore
