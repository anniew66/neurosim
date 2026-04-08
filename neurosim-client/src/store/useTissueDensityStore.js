// store/useTissueDensityStore.js
// Stroke-based tissue density.
// Each stroke is a polyline { id, points:[[x,y,z],...], radius, density }.
// Rendered as TubeGeometry meshes with sphere caps.

import { create } from 'zustand'
import { distPointToPolyline } from '../lib/geometryUtils.js'

const useTissueDensityStore = create((set, get) => ({
  strokes:      [],     // { id, points:[[x,y,z],...], radius, density }
  diffusion:    2.0,
  baseDensity:  0.0,
  brushDensity: 0.6,
  version:      0,

  addStroke(points, radius, density) {
    const id = crypto.randomUUID()
    set(s => ({
      strokes: [...s.strokes, { id, points: points.map(p => [...p]), radius, density: density ?? s.brushDensity }],
      version: s.version + 1,
    }))
    return id
  },

  setDiffusion(v)    { set({ diffusion: v }) },
  setBaseDensity(v)  { set({ baseDensity: v }) },
  setBrushDensity(v) { set({ brushDensity: v }) },
  clearStrokes()     { set(s => ({ strokes: [], version: s.version + 1 })) },

  snapshotStrokes() {
    return get().strokes.map(st => ({ ...st, points: st.points.map(p => [...p]) }))
  },

  restoreStrokes(strokes) {
    set(s => ({
      strokes: strokes.map(st => ({ ...st, points: st.points.map(p => [...p]) })),
      version: s.version + 1,
    }))
  },

  isEmpty() { return get().strokes.length === 0 },

  sim_extent: 1.0,
  syncToExtent(extent) { set({ sim_extent: extent }) },

  exportForJulia() {
    const { strokes, diffusion, baseDensity } = get()
    const res = 32, span = 60, origin = [-30, -30, -30]
    const cellSize = span / res
    const data = new Float32Array(res * res * res)

    // Process positive strokes first, then negative — matches render order
    // and ensures subtraction always operates on accumulated positive values.
    const ordered = [...strokes].sort((a, b) => (a.density >= 0 ? 0 : 1) - (b.density >= 0 ? 0 : 1))
    for (const stroke of ordered) {
      const effR   = stroke.radius * (1 + diffusion)
      const sigma  = stroke.radius * Math.max(0.01, diffusion)
      const sigma2 = 2 * sigma * sigma

      // AABB of polyline expanded by effR
      let mnX = Infinity, mnY = Infinity, mnZ = Infinity
      let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity
      for (const p of stroke.points) {
        mnX = Math.min(mnX, p[0]); mxX = Math.max(mxX, p[0])
        mnY = Math.min(mnY, p[1]); mxY = Math.max(mxY, p[1])
        mnZ = Math.min(mnZ, p[2]); mxZ = Math.max(mxZ, p[2])
      }

      const imin = Math.max(0,       Math.floor((mnX - effR - origin[0]) / cellSize))
      const imax = Math.min(res - 1, Math.ceil ((mxX + effR - origin[0]) / cellSize))
      const jmin = Math.max(0,       Math.floor((mnY - effR - origin[1]) / cellSize))
      const jmax = Math.min(res - 1, Math.ceil ((mxY + effR - origin[1]) / cellSize))
      const kmin = Math.max(0,       Math.floor((mnZ - effR - origin[2]) / cellSize))
      const kmax = Math.min(res - 1, Math.ceil ((mxZ + effR - origin[2]) / cellSize))

      for (let k = kmin; k <= kmax; k++)
        for (let j = jmin; j <= jmax; j++)
          for (let i = imin; i <= imax; i++) {
            const wx = origin[0] + i * cellSize
            const wy = origin[1] + j * cellSize
            const wz = origin[2] + k * cellSize
            const d = distPointToPolyline(wx, wy, wz, stroke.points)
            if (d > effR) continue
            let val = Math.abs(stroke.density)
            if (d > stroke.radius) val *= Math.exp(-((d - stroke.radius) ** 2) / sigma2)
            const idx = i + j * res + k * res * res
            if (stroke.density >= 0) {
              data[idx] = Math.min(1, data[idx] + val)
            } else {
              data[idx] = Math.max(0, data[idx] - val)
            }
          }
    }
    return { nx: res, ny: res, nz: res, origin, cell_size: cellSize, data: Array.from(data), base_density: baseDensity }
  },
}))

export default useTissueDensityStore
