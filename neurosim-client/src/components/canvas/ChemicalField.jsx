// components/canvas/ChemicalField.jsx
//
// 1. Point-source spheres (instanced halos + cores from useSceneStore).
// 2. Painted chemical fields (tube strokes from useChemPaintStore).

import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useSceneStore     from '../../store/useSceneStore.js'
import useChemPaintStore from '../../store/useChemPaintStore.js'
import { CHEMICAL_COLORS } from '../../lib/neuronDefaults.js'

const MAX_CHEMS = 200
const dummy = new THREE.Object3D()
const _col  = new THREE.Color()

// ── Shared shaders ──────────────────────────────────────────────────────────
const FILL_VERT = /* glsl */`
  uniform float uDensity;
  varying float vDensity;
  varying vec3  vWorldPos;
  varying vec3  vWorldNormal;
  void main() {
    vDensity     = uDensity;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos    = worldPos.xyz;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    gl_Position  = projectionMatrix * viewMatrix * worldPos;
  }
`

const FILL_FRAG = /* glsl */`
  precision highp float;
  varying float vDensity;
  varying vec3  vWorldPos;
  varying vec3  vWorldNormal;
  uniform float uOpacityScale;
  uniform vec3  uColor;
  void main() {
    vec3  viewDir  = normalize(cameraPosition - vWorldPos);
    float facing   = abs(dot(vWorldNormal, viewDir));
    float edgeSoft = smoothstep(0.0, 0.3, facing);
    float a = vDensity * uOpacityScale * edgeSoft;
    gl_FragColor = vec4(uColor * a, a);
  }
`

const EDGE_VERT = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos    = worldPos.xyz;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    gl_Position  = projectionMatrix * viewMatrix * worldPos;
  }
`

const EDGE_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  uniform vec3 uColor;
  void main() {
    vec3  viewDir = normalize(cameraPosition - vWorldPos);
    float edge    = abs(dot(vWorldNormal, viewDir));
    if (edge > 0.12) discard;
    float screenDash = mod(gl_FragCoord.x + gl_FragCoord.y, 12.0);
    if (screenDash < 6.0) discard;
    float intensity = smoothstep(0.12, 0.0, edge) * 0.6;
    gl_FragColor = vec4(uColor * intensity, intensity);
  }
`

// ── Material factories ──────────────────────────────────────────────────────
function makeFillMat(density, color) {
  const isErase = density < 0
  const mat = new THREE.ShaderMaterial({
    vertexShader: FILL_VERT, fragmentShader: FILL_FRAG,
    uniforms: {
      uDensity:      { value: Math.abs(density) },
      uOpacityScale: { value: 0.85 },
      uColor:        { value: color },
    },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendEquation: isErase ? THREE.ReverseSubtractEquation : THREE.MaxEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  })
  mat.stencilWrite     = true
  mat.stencilRef       = 1
  mat.stencilFunc      = isErase ? THREE.EqualStencilFunc : THREE.AlwaysStencilFunc
  mat.stencilZPass     = isErase ? THREE.KeepStencilOp    : THREE.ReplaceStencilOp
  mat.stencilWriteMask = isErase ? 0x00 : 0xff
  return mat
}

function makeEdgeMat(color) {
  return new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
    uniforms: { uColor: { value: color } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  })
}

// ── Per-stroke tube mesh ────────────────────────────────────────────────────
function ChemStroke({ stroke, diffusion, color }) {
  const { points, radius, density } = stroke
  const isErase = density < 0
  const fillR = radius
  const edgeR = radius * (1 + diffusion)
  const order = isErase ? 10 : 0

  const fillMat = useMemo(() => makeFillMat(density, color), [density, color])
  const edgeMat = useMemo(() => makeEdgeMat(color), [color])

  const { tubeGeo, edgeTubeGeo, capGeos } = useMemo(() => {
    if (points.length < 2) {
      return {
        tubeGeo: new THREE.SphereGeometry(fillR, 32, 24),
        edgeTubeGeo: isErase ? null : new THREE.SphereGeometry(edgeR, 48, 36),
        capGeos: null,
      }
    }
    const vecs = points.map(p => new THREE.Vector3(p[0], p[1], p[2]))
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal', 0.5)
    const segs = Math.max(8, points.length * 4)
    return {
      tubeGeo: new THREE.TubeGeometry(curve, segs, fillR, 16, false),
      edgeTubeGeo: isErase ? null : new THREE.TubeGeometry(curve, segs, edgeR, 24, false),
      capGeos: {
        fillStart: new THREE.SphereGeometry(fillR, 24, 16),
        fillEnd:   new THREE.SphereGeometry(fillR, 24, 16),
        edgeStart: isErase ? null : new THREE.SphereGeometry(edgeR, 32, 24),
        edgeEnd:   isErase ? null : new THREE.SphereGeometry(edgeR, 32, 24),
      },
    }
  }, [points, fillR, edgeR, isErase])

  useEffect(() => {
    return () => {
      tubeGeo.dispose()
      if (edgeTubeGeo) edgeTubeGeo.dispose()
      if (capGeos) {
        capGeos.fillStart.dispose(); capGeos.fillEnd.dispose()
        if (capGeos.edgeStart) capGeos.edgeStart.dispose()
        if (capGeos.edgeEnd) capGeos.edgeEnd.dispose()
      }
    }
  }, [tubeGeo, edgeTubeGeo, capGeos])

  const p0 = points[0]
  if (points.length < 2) {
    return (
      <group>
        <mesh geometry={tubeGeo} material={fillMat} position={p0} renderOrder={order} frustumCulled={false} />
        {edgeTubeGeo && <mesh geometry={edgeTubeGeo} material={edgeMat} position={p0} frustumCulled={false} />}
      </group>
    )
  }
  const pN = points[points.length - 1]
  return (
    <group>
      <mesh geometry={tubeGeo} material={fillMat} renderOrder={order} frustumCulled={false} />
      <mesh geometry={capGeos.fillStart} material={fillMat} position={p0} renderOrder={order} frustumCulled={false} />
      <mesh geometry={capGeos.fillEnd}   material={fillMat} position={pN} renderOrder={order} frustumCulled={false} />
      {edgeTubeGeo && <>
        <mesh geometry={edgeTubeGeo} material={edgeMat} frustumCulled={false} />
        <mesh geometry={capGeos.edgeStart} material={edgeMat} position={p0} frustumCulled={false} />
        <mesh geometry={capGeos.edgeEnd}   material={edgeMat} position={pN} frustumCulled={false} />
      </>}
    </group>
  )
}

// ── ChemVolume: one per chemical channel ────────────────────────────────────
function ChemVolume({ chemName }) {
  const version   = useChemPaintStore(s => s.channels[chemName]?.version ?? -1)
  const diffusion = useChemPaintStore(s => s.diffusion)
  const color = useMemo(() => new THREE.Color(CHEMICAL_COLORS[chemName] ?? CHEMICAL_COLORS.default), [chemName])

  if (version < 0) return null
  const strokes = useChemPaintStore.getState().channels[chemName]?.strokes ?? []

  return (
    <group>
      {strokes.map(s => <ChemStroke key={s.id} stroke={s} diffusion={diffusion} color={color} />)}
    </group>
  )
}

function ChemFieldVolumes() {
  const channelNames = useChemPaintStore(s => s.channelNames)
  return channelNames.map(name => <ChemVolume key={name} chemName={name} />)
}

// ── Main component (point sources + volumetric fields) ───────────────────────
export default function ChemicalField() {
  const chemicals = useSceneStore(s => s.chemicals)
  const coreRef   = useRef()
  const haloRef   = useRef()

  useEffect(() => {
    const core = coreRef.current
    const halo = haloRef.current
    if (!core || !halo) return
    const n = Math.min(chemicals.length, MAX_CHEMS)
    for (let i = 0; i < n; i++) {
      const ch = chemicals[i]
      _col.set(CHEMICAL_COLORS[ch.name] ?? CHEMICAL_COLORS.default)
      dummy.position.set(ch.source[0], ch.source[1], ch.source[2])
      dummy.scale.setScalar(Math.max(0.08, ch.sigma * 0.04))
      dummy.updateMatrix()
      core.setMatrixAt(i, dummy.matrix)
      core.setColorAt(i, _col)
      dummy.scale.setScalar(Math.max(0.4, ch.sigma * 0.25))
      dummy.updateMatrix()
      halo.setMatrixAt(i, dummy.matrix)
      halo.setColorAt(i, _col)
    }
    core.count = n; halo.count = n
    core.instanceMatrix.needsUpdate = true
    halo.instanceMatrix.needsUpdate = true
    if (core.instanceColor) core.instanceColor.needsUpdate = true
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true
  }, [chemicals])

  useFrame(({ clock }) => {
    const core = coreRef.current
    if (!core || core.count === 0) return
    const t = clock.getElapsedTime()
    for (let i = 0; i < core.count; i++) {
      const ch = chemicals[i]
      if (!ch) continue
      const pulse = 0.88 + 0.12 * Math.sin(t * 1.5 + i * 1.1)
      dummy.position.set(ch.source[0], ch.source[1], ch.source[2])
      dummy.scale.setScalar(Math.max(0.08, ch.sigma * 0.04) * pulse)
      dummy.updateMatrix()
      core.setMatrixAt(i, dummy.matrix)
    }
    core.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={haloRef} args={[null, null, MAX_CHEMS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.08} vertexColors />
      </instancedMesh>
      <instancedMesh ref={coreRef} args={[null, null, MAX_CHEMS]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.9} vertexColors />
      </instancedMesh>
      <ChemFieldVolumes />
    </group>
  )
}
