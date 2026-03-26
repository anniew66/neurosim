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


// ── Procedural neuropil density ──────────────────────────────────────────────
// Uses band-limited 3D noise sampled at each grid cell — O(res³) regardless
// of cell density. The old blob-per-loop approach was O(vol × density) which
// crashes at high density (200k/mm³ × 60³mm = 43 billion iterations).
//
// Algorithm: layered hash noise at a spatial frequency derived from blobRadius.
// High density → high frequency (cells pack tightly).
// Intensity → amplitude of the noise field.
// Result: continuous density field that looks like dense neuropil.

// Fast integer hash → float in [0,1]
function hash3(ix, iy, iz, seed) {
  let h = (ix * 1664525 + iy * 22695477 + iz * 1013904223 + seed) | 0
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16
  return (h >>> 0) / 0xffffffff
}

// Smooth value noise: trilinear interpolation of hashed lattice
function valueNoise3(fx, fy, fz, seed) {
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz)
  const dx = fx - ix, dy = fy - iy, dz = fz - iz
  // Smoothstep
  const ux = dx*dx*(3-2*dx), uy = dy*dy*(3-2*dy), uz = dz*dz*(3-2*dz)
  const v000 = hash3(ix,   iy,   iz,   seed)
  const v100 = hash3(ix+1, iy,   iz,   seed)
  const v010 = hash3(ix,   iy+1, iz,   seed)
  const v110 = hash3(ix+1, iy+1, iz,   seed)
  const v001 = hash3(ix,   iy,   iz+1, seed)
  const v101 = hash3(ix+1, iy,   iz+1, seed)
  const v011 = hash3(ix,   iy+1, iz+1, seed)
  const v111 = hash3(ix+1, iy+1, iz+1, seed)
  return v000*(1-ux)*(1-uy)*(1-uz) + v100*ux*(1-uy)*(1-uz) +
         v010*(1-ux)*uy*(1-uz)     + v110*ux*uy*(1-uz) +
         v001*(1-ux)*(1-uy)*uz     + v101*ux*(1-uy)*uz +
         v011*(1-ux)*uy*uz         + v111*ux*uy*uz
}

function generateNeuropil(data, res, cellSize, origin, span, cellDensity, blobRadius, intensity) {
  // Spatial frequency: how many "cells" fit across the span.
  // Derived from blobRadius so the noise features are soma-sized.
  // cellDensity lifts the mean density — modelled as a DC offset + noise.
  //   high density → most of the field is dense, small gaps
  //   low density  → mostly empty with isolated dense patches
  const blobsPerAxis   = span / (blobRadius * 2)          // how many blobs span the volume
  const noiseFreq      = blobsPerAxis / res                // lattice frequency per grid cell
  // Mean density from cell density: saturates toward 1 at cortical densities
  const meanDensity    = Math.min(0.95, 1 - Math.exp(-cellDensity / 50000))
  const noiseAmplitude = intensity * (1 - meanDensity * 0.5) // noise swing around mean

  for (let iz = 0; iz < res; iz++) {
    for (let iy = 0; iy < res; iy++) {
      for (let ix = 0; ix < res; ix++) {
        // Sample two octaves of noise for organic texture
        const fx = ix * noiseFreq
        const fy = iy * noiseFreq
        const fz = iz * noiseFreq
        const n1 = valueNoise3(fx,       fy,       fz,       1)
        const n2 = valueNoise3(fx*2+7.3, fy*2+3.1, fz*2+5.7, 2) * 0.5
        const n  = (n1 + n2) / 1.5   // combined, still [0..1]
        // Map noise to density: shift by meanDensity, scale by amplitude
        const d = Math.min(1.0, Math.max(0.0, meanDensity + (n - 0.5) * noiseAmplitude * 2))
        data[ix + iy * res + iz * res * res] = d
      }
    }
  }
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
  baseDensity:   0.0,

  // ── Neuropil generator settings ─────────────────────────────────────────────
  neuropilCellDensity: 2000,   // blobs/mm³
  neuropilBlobRadius:  0.012,  // mm — default matches generic soma (~12 µm)
  neuropilIntensity:   0.4,    // peak opacity per blob

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

  setBrushDensity(v)       { set({ brushDensity: v }) },
  setBaseDensity(v)        { set({ baseDensity: v }) },
  setNeuropilCellDensity(v){ set({ neuropilCellDensity: v }) },
  setNeuropilBlobRadius(v) { set({ neuropilBlobRadius: v }) },
  setNeuropilIntensity(v)  { set({ neuropilIntensity: v }) },
  setResolution(res)   { set({ resolution: res, data: makeGrid(res) }) },
  setSpan(span)        { set({ span }) },
  setOrigin(origin)    { set({ origin }) },
  clearGrid()          { set(s => ({ data: makeGrid(s.resolution) })) },

  // Restore a previously snapshotted grid (used by density undo).
  restoreGridSnapshot(snapshot) {
    set({ data: new Float32Array(snapshot) })
  },

  // Take a snapshot of the current grid data (returns a copy).
  snapshotGrid() {
    return get().data.slice()
  },

  // Generate a procedural neuropil density background.
  // cellDensity: blobs/mm³  (typical cortex: ~100,000 neurons/mm³, but blobs are coarser)
  // blobRadius:  mm (default 0.012 = ~12µm, close to generic soma radius)
  // intensity:   peak density per blob (0–1), blobs overlap and sum
  initNeuropil(overrides = {}) {
    const s        = get()
    const cellDensity = overrides.cellDensity ?? s.neuropilCellDensity
    const blobRadius  = overrides.blobRadius  ?? s.neuropilBlobRadius
    const intensity   = overrides.intensity   ?? s.neuropilIntensity
    const { resolution, origin } = s
    const span     = s.span
    const cellSize = s.getCellSize()
    const data     = makeGrid(resolution)
    generateNeuropil(data, resolution, cellSize, origin, span, cellDensity, blobRadius, intensity)
    set({ data })
  },

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
