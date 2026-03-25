// store/useTissueDensityStore.js
// 3D volumetric tissue density grid.
// Stored as a flat Float32Array (row-major xyz).
// Brush painting writes spheres of density into the grid.
// Sent to Julia as a flat array with grid metadata.

import { create } from 'zustand'

const DEFAULT_RES   = 32     // grid cells per axis (32³ = 32768 cells, ~128 KB)
const DEFAULT_SPAN  = 60.0   // mm — matches PaintSurface visualization size

function makeGrid(res) {
  return new Float32Array(res * res * res)
}

function idx(ix, iy, iz, res) {
  return ix + iy * res + iz * res * res
}

function paintSphere(data, res, cellSize, cx, cy, cz, radius, value, origin) {
  const r2 = radius * radius
  const imin = Math.max(0, Math.floor((cx - radius - origin[0]) / cellSize))
  const imax = Math.min(res - 1, Math.ceil((cx + radius - origin[0]) / cellSize))
  const jmin = Math.max(0, Math.floor((cy - radius - origin[1]) / cellSize))
  const jmax = Math.min(res - 1, Math.ceil((cy + radius - origin[1]) / cellSize))
  const kmin = Math.max(0, Math.floor((cz - radius - origin[2]) / cellSize))
  const kmax = Math.min(res - 1, Math.ceil((cz + radius - origin[2]) / cellSize))

  for (let k = kmin; k <= kmax; k++) {
    for (let j = jmin; j <= jmax; j++) {
      for (let i = imin; i <= imax; i++) {
        const wx = origin[0] + i * cellSize
        const wy = origin[1] + j * cellSize
        const wz = origin[2] + k * cellSize
        if ((wx-cx)**2 + (wy-cy)**2 + (wz-cz)**2 <= r2) {
          const i3 = idx(i, j, k, res)
          data[i3] = Math.min(1.0, Math.max(0.0, data[i3] + value))
        }
      }
    }
  }
}

function eraseSphere(data, res, cellSize, cx, cy, cz, radius, origin) {
  paintSphere(data, res, cellSize, cx, cy, cz, radius, -1.0, origin)
}

const useTissueDensityStore = create((set, get) => ({
  // Grid metadata
  resolution: DEFAULT_RES,         // cells per axis
  span:       DEFAULT_SPAN,        // mm — grid side length
  origin:     [-30, -30, -30],     // mm — centred at world origin: spans [-30..30]

  // Flat data array
  data: makeGrid(DEFAULT_RES),

  // Active density value for brush (0=erase, positive=add, negative=subtract)
  brushDensity:  0.6,

  // Base density applied uniformly across the entire volume (0–1).
  // Acts as a floor — painted values add ON TOP of this.
  baseDensity:   0.0,

  // ── Derived ──────────────────────────────────────────────────────────────────
  getCellSize() {
    const { resolution, span } = get()
    return span / resolution
  },

  // ── Actions ───────────────────────────────────────────────────────────────────
  // Paint density — brushDensity can be positive (add) or negative (carve below base)
  paint(cx, cy, cz, radius) {
    const { data, resolution, origin, brushDensity } = get()
    const cellSize = get().getCellSize()
    const next = new Float32Array(data)
    paintSphere(next, resolution, cellSize, cx, cy, cz, radius, brushDensity, origin)
    set({ data: next })
  },

  // Explicit erase — sets cells to 0 (removes painted density, base still applies)
  erase(cx, cy, cz, radius) {
    const { data, resolution, origin } = get()
    const cellSize = get().getCellSize()
    const next = new Float32Array(data)
    eraseSphere(next, resolution, cellSize, cx, cy, cz, radius, origin)
    set({ data: next })
  },

  setBrushDensity(v)   { set({ brushDensity: v }) },
  setBaseDensity(v)    { set({ baseDensity: v }) },
  setResolution(res)   { set({ resolution: res, data: makeGrid(res) }) },
  setSpan(span)        { set({ span }) },
  setOrigin(origin)    { set({ origin }) },
  clearGrid()          { set(s => ({ data: makeGrid(s.resolution) })) },

  // Store the sim extent for Julia export — does NOT change the visual span.
  // The visual span always matches the paint surface (60mm default).
  sim_extent: 1.0,
  syncToExtent(extent) {
    set({ sim_extent: extent })
  },

  // ── Evaluate density at world point (trilinear interpolation) ────────────────
  evalAt(wx, wy, wz) {
    const { data, resolution, origin, baseDensity } = get()
    const cellSize = get().getCellSize()
    const fx = (wx - origin[0]) / cellSize
    const fy = (wy - origin[1]) / cellSize
    const fz = (wz - origin[2]) / cellSize
    const ix = Math.min(resolution - 2, Math.max(0, Math.floor(fx)))
    const iy = Math.min(resolution - 2, Math.max(0, Math.floor(fy)))
    const iz = Math.min(resolution - 2, Math.max(0, Math.floor(fz)))
    const dx = fx - ix; const dy = fy - iy; const dz = fz - iz
    const res = resolution
    const painted = (
      data[idx(ix,  iy,  iz,  res)] * (1-dx) * (1-dy) * (1-dz) +
      data[idx(ix+1,iy,  iz,  res)] * dx     * (1-dy) * (1-dz) +
      data[idx(ix,  iy+1,iz,  res)] * (1-dx) * dy     * (1-dz) +
      data[idx(ix+1,iy+1,iz,  res)] * dx     * dy     * (1-dz) +
      data[idx(ix,  iy,  iz+1,res)] * (1-dx) * (1-dy) * dz     +
      data[idx(ix+1,iy,  iz+1,res)] * dx     * (1-dy) * dz     +
      data[idx(ix,  iy+1,iz+1,res)] * (1-dx) * dy     * dz     +
      data[idx(ix+1,iy+1,iz+1,res)] * dx     * dy     * dz
    )
    return Math.min(1.0, baseDensity + painted)
  },

  // ── Export for Julia ──────────────────────────────────────────────────────────
  // Returns an object matching the Julia TissueDensityGrid JSON format.
  exportForJulia() {
    const { data, resolution, span, origin } = get()
    return {
      nx:        resolution,
      ny:        resolution,
      nz:        resolution,
      origin,
      cell_size: get().getCellSize(),
      data:      Array.from(data),   // Float32Array → plain array for JSON
      base_density: get().baseDensity,
    }
  },

  // Whether there is any non-zero density
  isEmpty() {
    return get().data.every(v => v === 0)
  },
}))

export default useTissueDensityStore
