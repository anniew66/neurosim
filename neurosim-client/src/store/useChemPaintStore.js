// store/useChemPaintStore.js
// Per-chemical stroke arrays for volumetric visualisation.
// Each stroke is a polyline { id, points, radius, density }.

import { create } from 'zustand'
import { distPointToPolyline } from '../lib/geometryUtils.js'

const useChemPaintStore = create((set, get) => ({
  channels:     {},    // { [chemName]: { strokes: [], version: 0 } }
  channelNames: [],
  diffusion:    2.0,

  addStroke(name, points, radius, density = 0.6) {
    const { channels, channelNames } = get()
    const ch = channels[name]
    const stroke = { id: crypto.randomUUID(), points: points.map(p => [...p]), radius, density }

    if (ch) {
      set({ channels: { ...channels, [name]: { strokes: [...ch.strokes, stroke], version: ch.version + 1 } } })
    } else {
      set({
        channels: { ...channels, [name]: { strokes: [stroke], version: 1 } },
        channelNames: [...channelNames, name],
      })
    }
  },

  removeStrokesInRadius(name, cx, cy, cz, radius) {
    const { channels } = get()
    const ch = channels[name]
    if (!ch) return
    const keep = ch.strokes.filter(st => distPointToPolyline(cx, cy, cz, st.points) > radius)
    if (keep.length !== ch.strokes.length) {
      set({ channels: { ...channels, [name]: { strokes: keep, version: ch.version + 1 } } })
    }
  },

  setDiffusion(v) { set({ diffusion: v }) },

  clearChannel(name) {
    const { channels, channelNames } = get()
    const next = { ...channels }
    delete next[name]
    set({ channels: next, channelNames: channelNames.filter(n => n !== name) })
  },

  clearAll() { set({ channels: {}, channelNames: [] }) },
}))

export default useChemPaintStore
