// components/canvas/DensityCloud.jsx
// Renders tissue density strokes as TubeGeometry meshes with sphere caps.
// Fill: MaxEquation blending, fresnel edge softening, opacity scales with density.
// Contour: dashed silhouette at diffusion radius.

import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import useTissueDensityStore from '../../store/useTissueDensityStore.js'

const DENSITY_COLOR = [0.95, 0.55, 0.1]
const CONTOUR_COLOR = [1.0, 0.85, 0.6]

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
  uniform float uDensity;
  varying vec3  vWorldPos;
  varying vec3  vWorldNormal;

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

    float intensity = smoothstep(0.12, 0.0, edge) * 0.65;
    gl_FragColor = vec4(uColor * intensity, intensity);
  }
`

// ── Material factories ──────────────────────────────────────────────────────
function makeFillMat(density, color) {
  return new THREE.ShaderMaterial({
    vertexShader: FILL_VERT, fragmentShader: FILL_FRAG,
    uniforms: {
      uDensity:      { value: density },
      uOpacityScale: { value: 0.85 },
      uColor:        { value: new THREE.Color(...color) },
    },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  })
}

function makeEdgeMat(color) {
  return new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
    uniforms: { uColor: { value: new THREE.Color(...color) } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  })
}

// ── Per-stroke mesh ─────────────────────────────────────────────────────────
function StrokeMesh({ stroke, diffusion }) {
  const { points, radius, density } = stroke
  const fillR = radius
  const edgeR = radius * (1 + diffusion)

  const fillMat = useMemo(() => makeFillMat(density, DENSITY_COLOR), [density])
  const edgeMat = useMemo(() => makeEdgeMat(CONTOUR_COLOR), [])

  const { tubeGeo, edgeTubeGeo, capGeos } = useMemo(() => {
    if (points.length < 2) {
      return {
        tubeGeo: new THREE.SphereGeometry(fillR, 32, 24),
        edgeTubeGeo: new THREE.SphereGeometry(edgeR, 48, 36),
        capGeos: null,
      }
    }
    const vecs = points.map(p => new THREE.Vector3(p[0], p[1], p[2]))
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal', 0.5)
    const segs = Math.max(8, points.length * 4)
    return {
      tubeGeo: new THREE.TubeGeometry(curve, segs, fillR, 16, false),
      edgeTubeGeo: new THREE.TubeGeometry(curve, segs, edgeR, 24, false),
      capGeos: {
        fillStart: new THREE.SphereGeometry(fillR, 24, 16),
        fillEnd:   new THREE.SphereGeometry(fillR, 24, 16),
        edgeStart: new THREE.SphereGeometry(edgeR, 32, 24),
        edgeEnd:   new THREE.SphereGeometry(edgeR, 32, 24),
      },
    }
  }, [points, fillR, edgeR])

  useEffect(() => {
    return () => {
      tubeGeo.dispose()
      edgeTubeGeo.dispose()
      if (capGeos) {
        capGeos.fillStart.dispose(); capGeos.fillEnd.dispose()
        capGeos.edgeStart.dispose(); capGeos.edgeEnd.dispose()
      }
    }
  }, [tubeGeo, edgeTubeGeo, capGeos])

  const p0 = points[0]

  if (points.length < 2) {
    return (
      <group>
        <mesh geometry={tubeGeo} material={fillMat} position={p0} frustumCulled={false} />
        <mesh geometry={edgeTubeGeo} material={edgeMat} position={p0} frustumCulled={false} />
      </group>
    )
  }

  const pN = points[points.length - 1]
  return (
    <group>
      {/* Fill */}
      <mesh geometry={tubeGeo} material={fillMat} frustumCulled={false} />
      <mesh geometry={capGeos.fillStart} material={fillMat} position={p0} frustumCulled={false} />
      <mesh geometry={capGeos.fillEnd}   material={fillMat} position={pN} frustumCulled={false} />
      {/* Contour */}
      <mesh geometry={edgeTubeGeo} material={edgeMat} frustumCulled={false} />
      <mesh geometry={capGeos.edgeStart} material={edgeMat} position={p0} frustumCulled={false} />
      <mesh geometry={capGeos.edgeEnd}   material={edgeMat} position={pN} frustumCulled={false} />
    </group>
  )
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DensityCloud() {
  const version   = useTissueDensityStore(s => s.version)
  const strokes   = useTissueDensityStore(s => s.strokes)
  const diffusion = useTissueDensityStore(s => s.diffusion)

  return (
    <group>
      {strokes.map(s => <StrokeMesh key={s.id} stroke={s} diffusion={diffusion} />)}
    </group>
  )
}
