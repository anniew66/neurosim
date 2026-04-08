// store/useChemPaintStore.js
// Per-chemical stroke arrays for volumetric visualisation.
// Each stroke is a polyline { id, points, radius, density }.

import { create } from 'zustand'

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

  snapshotChannels() {
    const { channels, channelNames } = get()
    const snap = {}
    for (const name of channelNames) {
      const ch = channels[name]
      snap[name] = { strokes: ch.strokes.map(st => ({ ...st, points: st.points.map(p => [...p]) })), version: ch.version }
    }
    return { channels: snap, channelNames: [...channelNames] }
  },

  restoreChannels(snapshot) {
    const channels = {}
    for (const name of snapshot.channelNames) {
      const ch = snapshot.channels[name]
      channels[name] = { strokes: ch.strokes.map(st => ({ ...st, points: st.points.map(p => [...p]) })), version: (ch.version ?? 0) + 1 }
    }
    set({ channels, channelNames: [...snapshot.channelNames] })
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
