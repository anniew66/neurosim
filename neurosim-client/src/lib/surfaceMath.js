// lib/surfaceMath.js
// Parametric surface system for the paint plane.
//
// All surfaces are height fields: y = f(x, z, params)
// This covers flat, tilted, curved, and custom (RBF) surfaces.
//
// Ray intersection uses bisection along the ray — works for any smooth surface.

// ── Height field definitions ──────────────────────────────────────────────────

export const SURFACE_PRESETS = {
  flat: {
    label:       'Flat',
    description: 'Horizontal plane. Adjust Y offset to move it up or down.',
    icon:        '▬',
    params: {
      offsetY: { label: 'Y Offset', min: -20, max: 20, step: 0.5, default: 0 },
    },
    height(x, z, p) {
      return p.offsetY ?? 0
    },
  },

  tilted: {
    label:       'Tilted',
    description: 'Flat plane with adjustable pitch (X tilt) and roll (Z tilt).',
    icon:        '╱',
    params: {
      offsetY: { label: 'Y Offset', min: -20, max: 20,  step: 0.5,  default: 0   },
      pitch:   { label: 'Pitch °',  min: -60, max: 60,  step: 1,    default: 0   },
      roll:    { label: 'Roll °',   min: -60, max: 60,  step: 1,    default: 0   },
    },
    height(x, z, p) {
      const px = Math.tan(((p.pitch ?? 0) * Math.PI) / 180)
      const rz = Math.tan(((p.roll  ?? 0) * Math.PI) / 180)
      return (p.offsetY ?? 0) + px * x + rz * z
    },
  },

  sphereCap: {
    label:       'Sphere Cap',
    description: 'Concave or convex spherical bowl. Radius controls curvature.',
    icon:        '◡',
    params: {
      offsetY:  { label: 'Y Offset',  min: -20, max: 20,  step: 0.5,  default: 0  },
      radius:   { label: 'Radius',    min: 2,   max: 60,  step: 0.5,  default: 20 },
      concave:  { label: 'Concave',   type: 'bool',                   default: true },
    },
    height(x, z, p) {
      const r   = p.radius ?? 20
      const r2  = r * r
      const d2  = x * x + z * z
      if (d2 >= r2) return (p.offsetY ?? 0) - (p.concave ? -1 : 1) * r
      const dy  = Math.sqrt(r2 - d2)
      return (p.offsetY ?? 0) + (p.concave ? -dy : dy) + r
    },
  },

  cylinder: {
    label:       'Cylinder',
    description: 'Curved along one axis. Axis selects direction of curvature.',
    icon:        '⌒',
    params: {
      offsetY:  { label: 'Y Offset',  min: -20, max: 20,  step: 0.5,  default: 0  },
      radius:   { label: 'Radius',    min: 2,   max: 60,  step: 0.5,  default: 20 },
      concave:  { label: 'Concave',   type: 'bool',                   default: true },
      axisZ:    { label: 'Axis: Z',   type: 'bool',                   default: false },
    },
    height(x, z, p) {
      const r  = p.radius ?? 20
      const d  = p.axisZ ? z : x
      const d2 = d * d
      if (d2 >= r * r) return (p.offsetY ?? 0) + (p.concave ? -1 : 1) * r
      const dy = Math.sqrt(r * r - d2)
      return (p.offsetY ?? 0) + (p.concave ? -dy : dy) + r
    },
  },

  saddle: {
    label:       'Saddle',
    description: 'Hyperbolic paraboloid — curves up in one direction, down in the other.',
    icon:        '⋈',
    params: {
      offsetY:    { label: 'Y Offset',   min: -20, max: 20,  step: 0.5,   default: 0    },
      curvature:  { label: 'Curvature',  min: 0,   max: 0.5, step: 0.005, default: 0.05 },
    },
    height(x, z, p) {
      const k = p.curvature ?? 0.05
      return (p.offsetY ?? 0) + k * x * x - k * z * z
    },
  },

  wave: {
    label:       'Wave',
    description: 'Sinusoidal surface. Adjust amplitude, frequency, and phase independently.',
    icon:        '∿',
    params: {
      offsetY:    { label: 'Y Offset',   min: -20, max: 20,   step: 0.5,   default: 0   },
      amplitude:  { label: 'Amplitude',  min: 0,   max: 10,   step: 0.1,   default: 2   },
      freqX:      { label: 'Freq X',     min: 0,   max: 1,    step: 0.01,  default: 0.2 },
      freqZ:      { label: 'Freq Z',     min: 0,   max: 1,    step: 0.01,  default: 0.2 },
      phase:      { label: 'Phase',      min: 0,   max: 6.28, step: 0.05,  default: 0   },
    },
    height(x, z, p) {
      const A  = p.amplitude ?? 2
      const fx = p.freqX     ?? 0.2
      const fz = p.freqZ     ?? 0.2
      const ph = p.phase     ?? 0
      return (p.offsetY ?? 0) + A * Math.sin(fx * x + ph) * Math.cos(fz * z + ph)
    },
  },

  cone: {
    label:       'Cone',
    description: 'Linear radial slope — like the surface of a volcano or funnel.',
    icon:        '△',
    params: {
      offsetY:  { label: 'Y Offset', min: -20, max: 20,  step: 0.5,  default: 0    },
      slope:    { label: 'Slope',    min: -1,  max: 1,   step: 0.01, default: -0.3 },
    },
    height(x, z, p) {
      const k = p.slope ?? -0.3
      return (p.offsetY ?? 0) + k * Math.sqrt(x * x + z * z)
    },
  },

  custom: {
    label:       'Custom (RBF)',
    description: 'Shift-click in the viewport to place control points. The surface interpolates through them.',
    icon:        '✦',
    params: {
      offsetY:    { label: 'Base Y',    min: -20, max: 20, step: 0.5, default: 0   },
      smoothing:  { label: 'Smoothing', min: 0.1, max: 20, step: 0.1, default: 4.0 },
    },
    height(x, z, p, controlPoints = []) {
      const base = p.offsetY ?? 0
      if (controlPoints.length === 0) return base
      return base + rbfInterpolate(x, z, controlPoints, p.smoothing ?? 4.0)
    },
  },
}

// ── RBF interpolation ─────────────────────────────────────────────────────────
// Uses thin-plate spline kernel: phi(r) = r^2 * log(r + eps)
// Control points: [{ x, z, y }] where y is the desired height offset from base.

function rbfKernel(r, eps = 1e-6) {
  const r2 = r * r
  return r2 * Math.log(r + eps)
}

function rbfInterpolate(x, z, controlPoints, smoothing) {
  if (controlPoints.length === 0) return 0

  // Simple weighted RBF without solving the linear system — good enough for
  // interactive use. Full solve would require a matrix inversion per point change.
  let num = 0
  let den = 0
  for (const cp of controlPoints) {
    const dx = x - cp.x
    const dz = z - cp.z
    const r  = Math.sqrt(dx * dx + dz * dz)
    const w  = 1 / (1 + (r / smoothing) ** 2)   // inverse-distance weight
    num += w * cp.dy
    den += w
  }
  return den > 1e-10 ? num / den : 0
}

// ── Surface API ───────────────────────────────────────────────────────────────

/**
 * Evaluate height at (x, z) given surface type + params + control points.
 */
export function evalHeight(x, z, surfaceType, params, controlPoints = []) {
  const def = SURFACE_PRESETS[surfaceType] ?? SURFACE_PRESETS.flat
  return def.height(x, z, params, controlPoints)
}

/**
 * Evaluate surface normal at (x, z) by finite differences.
 * Returns a THREE.Vector3 (not imported here — caller normalises).
 */
export function evalNormal(x, z, surfaceType, params, controlPoints = []) {
  const eps = 0.1
  const yC  = evalHeight(x,       z,       surfaceType, params, controlPoints)
  const yX  = evalHeight(x + eps, z,       surfaceType, params, controlPoints)
  const yZ  = evalHeight(x,       z + eps, surfaceType, params, controlPoints)
  // Tangents: (eps, yX-yC, 0) and (0, yZ-yC, eps)
  // Normal = cross product
  const nx =  -(yX - yC)
  const ny =  eps
  const nz =  -(yZ - yC)
  const len = Math.sqrt(nx*nx + ny*ny + nz*nz)
  return [nx/len, ny/len, nz/len]
}

/**
 * Ray–surface intersection via bisection.
 * Ray: origin + t * direction
 * Returns { t, point: [x,y,z] } or null if no intersection found.
 *
 * Works by sampling f(t) = ray.y(t) - height(ray.x(t), ray.z(t))
 * and bisecting sign changes.
 */
export function raySurfaceIntersect(
  ox, oy, oz,   // ray origin
  dx, dy, dz,   // ray direction (need not be normalised)
  surfaceType, params, controlPoints = [],
  { tMin = 0.5, tMax = 200, steps = 80, bisectIter = 20 } = {}
) {
  function f(t) {
    const rx = ox + t * dx
    const ry = oy + t * dy
    const rz = oz + t * dz
    return ry - evalHeight(rx, rz, surfaceType, params, controlPoints)
  }

  // Step along ray to find sign change
  const dt = (tMax - tMin) / steps
  let tA   = tMin
  let fA   = f(tA)

  for (let i = 1; i <= steps; i++) {
    const tB = tMin + i * dt
    const fB = f(tB)

    if (fA * fB <= 0) {
      // Bisect in [tA, tB]
      let lo = tA, hi = tB
      for (let j = 0; j < bisectIter; j++) {
        const mid = (lo + hi) / 2
        const fM  = f(mid)
        if (fA * fM <= 0) { hi = mid } else { lo = mid; fA = fM }
      }
      const t = (lo + hi) / 2
      return {
        t,
        point: [ox + t*dx, oy + t*dy, oz + t*dz],
      }
    }
    tA = tB
    fA = fB
  }
  return null
}

/**
 * Build a grid of height samples for mesh visualisation.
 * Returns { positions: Float32Array, indices: Uint32Array } for a BufferGeometry.
 */
export function buildSurfaceMesh(
  surfaceType, params, controlPoints = [],
  { size = 40, divisions = 48, cx = 0, cz = 0 } = {}
) {
  const n    = divisions + 1
  const step = size / divisions
  const half = size / 2
  const positions = new Float32Array(n * n * 3)
  const indices   = []

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = cx - half + ix * step
      const z = cz - half + iz * step
      const y = evalHeight(x, z, surfaceType, params, controlPoints)
      const i = (iz * n + ix) * 3
      positions[i]   = x
      positions[i+1] = y
      positions[i+2] = z
    }
  }

  for (let iz = 0; iz < divisions; iz++) {
    for (let ix = 0; ix < divisions; ix++) {
      const a = iz * n + ix
      const b = a + 1
      const c = a + n
      const d = c + 1
      indices.push(a, b, c,  b, d, c)
    }
  }

  return { positions, indices: new Uint32Array(indices) }
}
