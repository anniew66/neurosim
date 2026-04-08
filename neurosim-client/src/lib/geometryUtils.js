// Minimum distance from point P to line segment AB
export function distPointToSegment(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const ab2 = abx * abx + aby * aby + abz * abz
  if (ab2 < 1e-12) return Math.sqrt(apx * apx + apy * apy + apz * apz)
  let t = (apx * abx + apy * aby + apz * abz) / ab2
  t = Math.max(0, Math.min(1, t))
  const dx = ax + t * abx - px
  const dy = ay + t * aby - py
  const dz = az + t * abz - pz
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Minimum distance from point P to polyline defined by points [[x,y,z],...]
export function distPointToPolyline(px, py, pz, points) {
  if (points.length === 1) {
    const a = points[0]
    const dx = px - a[0], dy = py - a[1], dz = pz - a[2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  let minD = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const d = distPointToSegment(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2])
    if (d < minD) minD = d
  }
  return minD
}
