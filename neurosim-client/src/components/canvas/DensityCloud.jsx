// components/canvas/DensityCloud.jsx
//
// Renders the 3D tissue density field as a continuous ray-marched volume —
// like fog filling a box. Dense regions are more opaque amber.
//
// Implementation:
//   • Unit box geometry ([-0.5..0.5]^3) scaled to VOL_SIZE mm.
//   • BackSide rendering so fragments fire for the back faces; the ray
//     origin is the camera position, direction toward each fragment.
//   • worldToLocal on the camera position accounts for scale, giving
//     coordinates already in [-0.5..0.5] — same space as the box and UVW.
//   • Data3DTexture stores painted density (R channel, 0-255).
//   • base density is a uniform added to every sample.
//   • Linear filtering on the texture gives spatial continuity.

import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useTissueDensityStore from '../../store/useTissueDensityStore.js'

// Matches PaintSurface buildSurfaceMesh call: size:60, centred at origin
// So the volume spans [-30..30] on all axes in world space.
const VOL_HALF = 30    // half-extent mm
const VOL_SIZE = VOL_HALF * 2   // 60 mm

const VERT = /* glsl */`
  varying vec3 vPos;   // in [-0.5..0.5] local box space
  void main() {
    vPos = position;   // unit box: position IS in [-0.5..0.5]
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */`
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform float     uBaseDensity;
  uniform float     uOpacity;
  uniform vec3      uCamLocal;  // camera in [-0.5..0.5] box space

  varying vec3 vPos;

  // Slab intersection for the [-0.5..0.5] unit box
  vec2 boxHit(vec3 ro, vec3 rd) {
    vec3 t0 = (-0.5 - ro) / rd;
    vec3 t1 = ( 0.5 - ro) / rd;
    vec3 tA = min(t0, t1);
    vec3 tB = max(t0, t1);
    float tNear = max(max(tA.x, tA.y), tA.z);
    float tFar  = min(min(tB.x, tB.y), tB.z);
    return vec2(tNear, tFar);
  }

  void main() {
    vec3 ro = uCamLocal;
    vec3 rd = normalize(vPos - uCamLocal);  // both in [-0.5..0.5] space ✓

    vec2 tb = boxHit(ro, rd);
    float tNear = max(tb.x, 0.0);
    float tFar  = tb.y;
    if (tFar <= tNear) discard;

    const int STEPS = 80;
    float dt = (tFar - tNear) / float(STEPS);
    vec4 acc = vec4(0.0);

    for (int i = 0; i < STEPS; i++) {
      float t   = tNear + (float(i) + 0.5) * dt;
      vec3  p   = ro + t * rd;          // [-0.5..0.5]
      vec3  uvw = p + 0.5;              // [0..1] — texture coords

      float painted = texture(uVolume, uvw).r;
      float d       = clamp(uBaseDensity + painted, 0.0, 1.0);
      if (d < 0.005) continue;

      // Amber hue: warm orange-gold
      vec3 col = vec3(0.9 + d * 0.1, 0.5 * d, 0.05 * d);
      float a  = clamp(d * uOpacity * dt, 0.0, 0.08);

      // Front-to-back alpha compositing
      acc.rgb += (1.0 - acc.a) * col * a;
      acc.a   += (1.0 - acc.a) * a;
      if (acc.a > 0.95) break;
    }

    if (acc.a < 0.004) discard;
    gl_FragColor = acc;
  }
`

export default function DensityCloud() {
  const meshRef     = useRef()
  const matRef      = useRef()
  const texRef      = useRef(null)

  const data        = useTissueDensityStore(s => s.data)
  const resolution  = useTissueDensityStore(s => s.resolution)
  const baseDensity = useTissueDensityStore(s => s.baseDensity)

  // ── Shader material (created once) ─────────────────────────────────────────
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVolume:      { value: null },
        uBaseDensity: { value: 0.0 },
        uOpacity:     { value: 18.0 },
        uCamLocal:    { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite:  false,
      side:        THREE.BackSide,
    })
    matRef.current = m
    return m
  }, [])

  // ── 3D texture: create / resize on resolution change ──────────────────────
  useEffect(() => {
    const res = resolution
    const buf = new Uint8Array(res * res * res)
    const tex = new THREE.Data3DTexture(buf, res, res, res)
    tex.format          = THREE.RedFormat
    tex.type            = THREE.UnsignedByteType
    tex.minFilter       = THREE.LinearFilter
    tex.magFilter       = THREE.LinearFilter
    tex.wrapS           = THREE.ClampToEdgeWrapping
    tex.wrapT           = THREE.ClampToEdgeWrapping
    tex.wrapR           = THREE.ClampToEdgeWrapping
    tex.unpackAlignment = 1
    tex.needsUpdate     = true
    texRef.current = tex
    if (matRef.current) matRef.current.uniforms.uVolume.value = tex
    return () => tex.dispose()
  }, [resolution])

  // ── Upload painted data ────────────────────────────────────────────────────
  useEffect(() => {
    const tex = texRef.current
    if (!tex) return
    const buf = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) {
      buf[i] = Math.round(Math.min(1, Math.max(0, data[i])) * 255)
    }
    tex.image.data  = buf
    tex.needsUpdate = true
  }, [data, resolution])

  // ── Keep baseDensity uniform current ──────────────────────────────────────
  useEffect(() => {
    if (matRef.current) matRef.current.uniforms.uBaseDensity.value = baseDensity
  }, [baseDensity])

  // ── Update camera position every frame (useFrame = R3F per-frame hook) ────
  // worldToLocal accounts for the mesh scale, converting world coords into
  // the local [-0.5..0.5] unit-box space that the shader expects.
  const _tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    if (!meshRef.current || !matRef.current) return
    _tmp.copy(camera.position)
    meshRef.current.worldToLocal(_tmp)
    matRef.current.uniforms.uCamLocal.value.copy(_tmp)
  })

  return (
    <mesh
      ref={meshRef}
      material={material}
      position={[0, 0, 0]}
      scale={[VOL_SIZE, VOL_SIZE, VOL_SIZE]}
    >
      {/*
        Unit box [-0.5..0.5]^3 scaled to VOL_SIZE.
        Spans [-30..30] in world space on all axes — centred at origin.
        Matches PaintSurface which also spans [-30..30] in XZ.
      */}
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  )
}
