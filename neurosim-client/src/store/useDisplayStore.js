// store/useDisplayStore.js
// Controls how the 3D viewport presents agents visually.
// Physical sizes are in mm; displayMagnification scales them for visibility.

import { create } from 'zustand'

const useDisplayStore = create((set) => ({
  // Multiplier applied to soma_radius for rendering.
  // 1.0 = physically accurate (neurons invisible at default 1mm extent).
  // 20.0 = comfortable default — granule cells ~visible, Purkinje cells prominent.
  displayMagnification: 20.0,

  // Show neurites as lines between soma and growth cone positions
  showNeurites: true,

  // Show chemical field spheres
  showChemicals: true,

  // Selected neuron highlight scale (multiplier on top of display mag)
  selectionScale: 2.2,

  setDisplayMagnification(v) { set({ displayMagnification: v }) },
  setShowNeurites(v)         { set({ showNeurites: v }) },
  setShowChemicals(v)        { set({ showChemicals: v }) },
}))

export default useDisplayStore
