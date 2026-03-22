// components/canvas/Grid.jsx
// Reference grid for the 3D viewport.
// Renders:
//   - Infinite grid plane (via @react-three/drei Grid)
//   - X / Y / Z axis lines with color coding
//   - Numeric tick labels along each axis
//   - A faint bounding-box outline matching the Julia sim extent

import { useRef, useMemo } from 'react'
import { Grid as DreiGrid, Text, Line } from '@react-three/drei'
import * as THREE from 'three'
import useSimStore          from '../../store/useSimStore.js'
import usePaintSurfaceStore from '../../store/usePaintSurfaceStore.js'

// ── Axis colors matching ParaView / GizmoViewport convention ─────────────────
const X_COLOR = '#e53935'   // red
const Y_COLOR = '#00e5a0'   // green
const Z_COLOR = '#2979ff'   // blue
const DIM_COLOR = '#1a2838'

// ── Single axis line + tick labels ───────────────────────────────────────────
function AxisLine({ direction, length, color, label, tickSpacing = 5 }) {
  const end = useMemo(() => {
    const d = new THREE.Vector3(...direction).normalize().multiplyScalar(length)
    return [d.x, d.y, d.z]
  }, [direction, length])

  const ticks = useMemo(() => {
    const out = []
    const d   = new THREE.Vector3(...direction).normalize()
    for (let t = tickSpacing; t <= length; t += tickSpacing) {
      out.push({
        pos: [d.x * t, d.y * t, d.z * t],
        val: t,
      })
    }
    return out
  }, [direction, length, tickSpacing])

  return (
    <group>
      {/* Main axis line */}
      <Line
        points={[[0, 0, 0], end]}
        color={color}
        lineWidth={1.5}
        opacity={0.7}
        transparent
      />

      {/* Axis letter label at the tip */}
      <Text
        position={[end[0] * 1.06, end[1] * 1.06 + 0.3, end[2] * 1.06]}
        fontSize={0.55}
        color={color}
        anchorX="center"
        anchorY="middle"
        depthOffset={-1}
        renderOrder={2}
      >
        {label}
      </Text>

      {/* Tick marks + numeric labels */}
      {ticks.map(({ pos, val }) => (
        <group key={val} position={pos}>
          {/* Short tick cross line perpendicular to axis */}
          <Line
            points={[[-0.12, 0, 0], [0.12, 0, 0]]}
            color={color}
            lineWidth={0.8}
            opacity={0.4}
            transparent
          />
          <Text
            position={[0, 0.35, 0]}
            fontSize={0.28}
            color={color}
            anchorX="center"
            anchorY="bottom"
            fillOpacity={0.55}
            depthOffset={-1}
            renderOrder={2}
          >
            {val}
          </Text>
        </group>
      ))}
    </group>
  )
}

// ── Sim extent bounding box ───────────────────────────────────────────────────
function ExtentBox({ extent }) {
  const e = extent / 2     // half-extent; box is centered at origin

  // 12 edges of a cube as line pairs
  const edges = useMemo(() => {
    const c = [
      [-e,-e,-e],[e,-e,-e],[e,e,-e],[-e,e,-e],
      [-e,-e, e],[e,-e, e],[e,e, e],[-e,e, e],
    ]
    return [
      [c[0],c[1]],[c[1],c[2]],[c[2],c[3]],[c[3],c[0]],  // bottom face
      [c[4],c[5]],[c[5],c[6]],[c[6],c[7]],[c[7],c[4]],  // top face
      [c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]],  // verticals
    ]
  }, [e])

  return (
    <group>
      {edges.map(([a, b], i) => (
        <Line
          key={i}
          points={[a, b]}
          color="#243444"
          lineWidth={0.6}
          opacity={0.35}
          transparent
          dashed
          dashSize={0.6}
          gapSize={0.4}
        />
      ))}
      {/* Corner labels */}
      {[
        { pos: [ e,  e,  e], label: `+${extent/2}` },
        { pos: [-e, -e, -e], label: `−${extent/2}` },
      ].map(({ pos, label }) => (
        <Text
          key={label}
          position={pos}
          fontSize={0.28}
          color="#3d5470"
          anchorX="center"
          anchorY="middle"
          depthOffset={-1}
        >
          {label}
        </Text>
      ))}
    </group>
  )
}

// ── Origin marker ─────────────────────────────────────────────────────────────
function OriginMarker() {
  return (
    <mesh position={[0, 0.02, 0]}>
      <ringGeometry args={[0.06, 0.14, 24]} />
      <meshBasicMaterial color="#ffffff" opacity={0.25} transparent side={THREE.DoubleSide} />
    </mesh>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SceneGrid() {
  const extent    = useSimStore(s => s.params.extent)
  // Y offset from flat surface params (approximation for grid position)
  const paintPlaneY = usePaintSurfaceStore(s => s.params.offsetY ?? 0)

  // The grid sits at paintPlaneY so it moves with the paint plane
  const yPos = paintPlaneY - 0.005

  return (
    <group position={[0, yPos, 0]}>
      {/* Drei infinite grid — fine and section lines */}
      <DreiGrid
        args={[200, 200]}
        cellSize={1}
        cellThickness={0.3}
        cellColor={DIM_COLOR}
        sectionSize={5}
        sectionThickness={0.7}
        sectionColor="#1e303f"
        fadeDistance={80}
        fadeStrength={1.4}
        infiniteGrid
        position={[0, 0, 0]}
      />

      {/* Axis lines radiating from origin */}
      <group position={[0, 0.01, 0]}>
        <AxisLine direction={[1, 0, 0]} length={extent * 0.55} color={X_COLOR} label="X" tickSpacing={5} />
        <AxisLine direction={[0, 1, 0]} length={extent * 0.25} color={Y_COLOR} label="Y" tickSpacing={5} />
        <AxisLine direction={[0, 0, 1]} length={extent * 0.55} color={Z_COLOR} label="Z" tickSpacing={5} />
      </group>

      <OriginMarker />

      {/* Sim bounding box (centered, half-extent each side) */}
      <ExtentBox extent={extent} />
    </group>
  )
}
