// components/canvas/SimViewer.jsx

import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls }              from '@react-three/drei'
import * as THREE from 'three'

// Reasonable cap — most sims won't exceed this.
// 200k segs × 2 buffers (axon+dend) × 2 arrays (pos+col) × 6 floats × 4 bytes = ~38MB total
const MAX_SEGS = 200000
const SOMA_CAP = 20000
const POLL_MS  = 800
// Drain at most this many raw segs per frame to avoid GPU stalls
const DRAIN_PER_FRAME = 20000

// Base colors for axons and dendrites
const AXON_R = 0.20, AXON_G = 0.52, AXON_B = 0.95
const DEND_R = 0.90, DEND_G = 0.22, DEND_B = 0.22

// ── Shaders ───────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute vec3 color;
  varying   vec3 vColor;
  void main() {
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG = /* glsl */`
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor, 1.0); }
`

// ── Helpers ───────────────────────────────────────────────────────────────────
function somaColor(h, firing) {
  const c = new THREE.Color()
  c.setHSL(h > 0.6 ? 0.33 : h > 0.3 ? 0.09 : 0.0, 0.85,
           h > 0.6 ? 0.38 : h > 0.3 ? 0.42 : 0.36)
  if (firing > 0.005) c.lerp(new THREE.Color(1.0, 0.93, 0.15), Math.min(1, firing * 6))
  return c
}

function percentileBounds(items, lo = 0.05, hi = 0.95) {
  if (!items.length) return null
  const xs = items.map(s => s.pos[0]).sort((a,b)=>a-b)
  const ys = items.map(s => s.pos[1]).sort((a,b)=>a-b)
  const zs = items.map(s => s.pos[2]).sort((a,b)=>a-b)
  const pick = (a,f) => a[Math.max(0, Math.min(a.length-1, Math.floor(f*a.length)))]
  return {
    cx: (pick(xs,lo)+pick(xs,hi))*.5, cy: (pick(ys,lo)+pick(ys,hi))*.5,
    cz: (pick(zs,lo)+pick(zs,hi))*.5,
    size: Math.max(pick(xs,hi)-pick(xs,lo), pick(ys,hi)-pick(ys,lo),
                   pick(zs,hi)-pick(zs,lo), 0.001),
  }
}

function upperBound(arr, val, count) {
  let lo = 0, hi = count
  while (lo < hi) { const m=(lo+hi)>>>1; arr[m]<=val?(lo=m+1):(hi=m) }
  return lo
}

// ── Scene ─────────────────────────────────────────────────────────────────────
function SimScene({ sharedRef, somaScaleRef, displayTRef, showAxons, showDends,
                    onSelectSoma, selectedRef, dimFactorRef }) {
  const { scene, camera, gl } = useThree()

  const somaRef   = useRef(null)
  const axonRef   = useRef(null)
  const dendRef   = useRef(null)
  const somaDummy = useMemo(() => new THREE.Object3D(), [])
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const somaData  = useRef([])

  // Typed arrays for shaft data
  const axonPos   = useRef(new Float32Array(MAX_SEGS * 6))
  const axonCol   = useRef(new Float32Array(MAX_SEGS * 6))
  const axonTimes = useRef(new Float32Array(MAX_SEGS))
  const axonNids  = useRef(new Float32Array(MAX_SEGS))
  const axonCount = useRef(0)
  const dendPos   = useRef(new Float32Array(MAX_SEGS * 6))
  const dendCol   = useRef(new Float32Array(MAX_SEGS * 6))
  const dendTimes = useRef(new Float32Array(MAX_SEGS))
  const dendNids  = useRef(new Float32Array(MAX_SEGS))
  const dendCount = useRef(0)

  const camFitted = useRef(false)
  const lastFit   = useRef(0)

  // Dimming state tracking
  const prevSelNidx   = useRef(null)
  const prevDimFactor = useRef(null)
  const prevAxonN     = useRef(0)
  const prevDendN     = useRef(0)

  useEffect(() => {
    // Somas
    const sg = new THREE.SphereGeometry(1, 12, 10)
    const sm = new THREE.InstancedMesh(sg,
      new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.05,
                                        clearcoat: 0.3, clearcoatRoughness: 0.3 }), SOMA_CAP)
    sm.count = 0; sm.frustumCulled = false
    somaRef.current = sm; scene.add(sm)

    // Line shader helper
    const makeLinesGeo = (posArr, colArr) => {
      const geo = new THREE.BufferGeometry()
      const pA = new THREE.BufferAttribute(posArr, 3)
      const cA = new THREE.BufferAttribute(colArr, 3)
      pA.setUsage(THREE.DynamicDrawUsage)
      cA.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('position', pA)
      geo.setAttribute('color',    cA)
      geo.setDrawRange(0, 0)
      return geo
    }

    const axGeo = makeLinesGeo(axonPos.current, axonCol.current)
    const axMesh = new THREE.LineSegments(axGeo,
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG }))
    axMesh.frustumCulled = false
    axonRef.current = axMesh; scene.add(axMesh)

    const dnGeo = makeLinesGeo(dendPos.current, dendCol.current)
    const dnMesh = new THREE.LineSegments(dnGeo,
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG }))
    dnMesh.frustumCulled = false
    dendRef.current = dnMesh; scene.add(dnMesh)

    return () => {
      scene.remove(sm);     sg.dispose();    sm.material.dispose()
      scene.remove(axMesh); axGeo.dispose(); axMesh.material.dispose()
      scene.remove(dnMesh); dnGeo.dispose(); dnMesh.material.dispose()
    }
  }, [scene])

  useEffect(() => { if (axonRef.current) axonRef.current.visible = showAxons }, [showAxons])
  useEffect(() => { if (dendRef.current) dendRef.current.visible = showDends }, [showDends])

  // Click to select soma
  const handleClick = useCallback(e => {
    const somas = somaData.current
    if (!somas.length || !somaRef.current) return
    const rect = gl.domElement.getBoundingClientRect()
    const x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    const y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    raycaster.setFromCamera({ x, y }, camera)
    const hits = raycaster.intersectObject(somaRef.current)
    onSelectSoma(hits.length > 0 ? somas[hits[0].instanceId] : null)
  }, [camera, gl, raycaster, onSelectSoma])

  useEffect(() => {
    const el = gl.domElement
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [gl, handleClick])

  // ── Recolor segments for selection dimming ──────────────────────────────────
  const recolorSegments = (selNidx, dim) => {
    const recolor = (colArr, nidsArr, count, br, bg, bb) => {
      for (let i = 0; i < count; i++) {
        const isDimmed = selNidx !== null && nidsArr[i] !== selNidx
        const f = isDimmed ? dim : 1.0
        const base = i * 6
        colArr[base]   = br*f; colArr[base+1] = bg*f; colArr[base+2] = bb*f
        colArr[base+3] = br*f; colArr[base+4] = bg*f; colArr[base+5] = bb*f
      }
    }
    recolor(axonCol.current, axonNids.current, axonCount.current, AXON_R, AXON_G, AXON_B)
    recolor(dendCol.current, dendNids.current, dendCount.current, DEND_R, DEND_G, DEND_B)
    if (axonRef.current) axonRef.current.geometry.attributes.color.needsUpdate = true
    if (dendRef.current) dendRef.current.geometry.attributes.color.needsUpdate = true
  }

  useFrame(() => {
    const shared = sharedRef.current
    if (!shared || !somaRef.current) return

    const ext      = shared.extent || 1.0
    const displayT = displayTRef.current
    const selNidx  = selectedRef.current?.nidx ?? null
    const dim      = dimFactorRef.current

    // ── Somas ────────────────────────────────────────────────────────────────
    const sm    = somaRef.current
    const somas = shared.somas || []
    somaData.current = somas
    const ns = Math.min(somas.length, SOMA_CAP)
    let rendered = 0
    for (let i = 0; i < ns; i++) {
      const s = somas[i]
      // Hide dead neurons after their time of death
      if (s.dead && displayT >= s.death_t) continue
      somaDummy.position.set(s.pos[0], s.pos[1], s.pos[2])
      somaDummy.scale.setScalar(Math.max(ext * 0.003, s.r * somaScaleRef.current))
      somaDummy.updateMatrix()
      sm.setMatrixAt(rendered, somaDummy.matrix)

      const c = somaColor(s.h ?? 1, s.firing ?? 0)
      if (selNidx !== null && s.nidx !== selNidx) {
        c.multiplyScalar(dim)
      }
      sm.setColorAt(rendered, c)
      rendered++
    }
    sm.count = rendered
    sm.instanceMatrix.needsUpdate = true
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true

    // ── Atomic resync swap (history reload triggered by retraction) ──────────
    // loadTrajectories puts a fresh full-snapshot here; we memcpy it into the
    // existing GPU-bound Float32Arrays in a single frame so there's no blank
    // intermediate frame.
    const resync = shared.pendingResync
    if (resync) {
      axonPos.current.set(resync.axon.pos, 0)
      axonCol.current.set(resync.axon.col, 0)
      axonTimes.current.set(resync.axon.times, 0)
      axonNids.current.set(resync.axon.nids, 0)
      axonCount.current = resync.axon.count
      dendPos.current.set(resync.dend.pos, 0)
      dendCol.current.set(resync.dend.col, 0)
      dendTimes.current.set(resync.dend.times, 0)
      dendNids.current.set(resync.dend.nids, 0)
      dendCount.current = resync.dend.count
      shared.lastResyncT = resync.t
      shared.pendingResync = null
      if (axonRef.current) {
        axonRef.current.geometry.attributes.position.needsUpdate = true
        axonRef.current.geometry.attributes.color.needsUpdate    = true
      }
      if (dendRef.current) {
        dendRef.current.geometry.attributes.position.needsUpdate = true
        dendRef.current.geometry.attributes.color.needsUpdate    = true
      }
      // Force recolor on next selection-check pass
      prevAxonN.current = -1
      prevDendN.current = -1
    }

    // ── Drain loadedSegs (history) — batch over multiple frames ──────────────
    // (legacy path; the resync-swap above is the primary load mechanism now)
    const loadQueue = shared.loadQueue
    if (loadQueue && loadQueue.length > 0) {
      const chunk = loadQueue.shift()
      if (chunk) {
        const drainChunk = (posArr, colArr, timesArr, nidsArr, countRef, isAxon, br, bg, bb) => {
          let ptr = countRef.current * 6
          let n   = countRef.current
          for (let i = 0; i < chunk.length; i++) {
            const s = chunk[i]
            if (s[6] !== (isAxon ? 1 : 0)) continue
            if (n >= MAX_SEGS) break
            posArr[ptr]=s[0]; posArr[ptr+1]=s[1]; posArr[ptr+2]=s[2]
            posArr[ptr+3]=s[3]; posArr[ptr+4]=s[4]; posArr[ptr+5]=s[5]
            // Apply dimming to new segments if a neuron is selected
            const isDimmed = selNidx !== null && s[7] !== selNidx
            const f = isDimmed ? dim : 1.0
            colArr[ptr]=br*f; colArr[ptr+1]=bg*f; colArr[ptr+2]=bb*f
            colArr[ptr+3]=br*f; colArr[ptr+4]=bg*f; colArr[ptr+5]=bb*f
            nidsArr[n] = s[7] ?? -1
            timesArr[n] = s[8] ?? 0
            ptr += 6; n++
          }
          countRef.current = n
        }
        drainChunk(axonPos.current, axonCol.current, axonTimes.current, axonNids.current, axonCount, true,  AXON_R, AXON_G, AXON_B)
        drainChunk(dendPos.current, dendCol.current, dendTimes.current, dendNids.current, dendCount, false, DEND_R, DEND_G, DEND_B)

        const updateRange = (ref) => {
          const attr = ref.current?.geometry?.attributes?.position
          if (!attr) return
          attr.needsUpdate = true
          ref.current.geometry.attributes.color.needsUpdate = true
        }
        updateRange(axonRef)
        updateRange(dendRef)
      }
    }

    // ── Drain live pendingSegs ────────────────────────────────────────────────
    const pending = shared.pendingSegs
    if (pending && pending.length > 0) {
      const drainLive = (posArr, colArr, timesArr, nidsArr, countRef, isAxon, br, bg, bb) => {
        let ptr = countRef.current * 6
        let n   = countRef.current
        for (let i = 0; i < pending.length; i++) {
          const s = pending[i]
          if (s[6] !== (isAxon ? 1 : 0)) continue
          if (n >= MAX_SEGS) break
          posArr[ptr]=s[0]; posArr[ptr+1]=s[1]; posArr[ptr+2]=s[2]
          posArr[ptr+3]=s[3]; posArr[ptr+4]=s[4]; posArr[ptr+5]=s[5]
          const isDimmed = selNidx !== null && s[7] !== selNidx
          const f = isDimmed ? dim : 1.0
          colArr[ptr]=br*f; colArr[ptr+1]=bg*f; colArr[ptr+2]=bb*f
          colArr[ptr+3]=br*f; colArr[ptr+4]=bg*f; colArr[ptr+5]=bb*f
          nidsArr[n] = s[7] ?? -1
          timesArr[n] = s[8] ?? 0
          ptr += 6; n++
        }
        countRef.current = n
      }
      drainLive(axonPos.current, axonCol.current, axonTimes.current, axonNids.current, axonCount, true,  AXON_R, AXON_G, AXON_B)
      drainLive(dendPos.current, dendCol.current, dendTimes.current, dendNids.current, dendCount, false, DEND_R, DEND_G, DEND_B)
      shared.pendingSegs = []
      axonRef.current.geometry.attributes.position.needsUpdate = true
      axonRef.current.geometry.attributes.color.needsUpdate    = true
      dendRef.current.geometry.attributes.position.needsUpdate = true
      dendRef.current.geometry.attributes.color.needsUpdate    = true
    }

    // ── Recolor on selection / dim factor change ─────────────────────────────
    const an = axonCount.current, dn = dendCount.current
    if (selNidx !== prevSelNidx.current ||
        dim !== prevDimFactor.current ||
        (selNidx !== null && (an !== prevAxonN.current || dn !== prevDendN.current))) {
      recolorSegments(selNidx, dim)
      prevSelNidx.current   = selNidx
      prevDimFactor.current = dim
      prevAxonN.current     = an
      prevDendN.current     = dn
    }

    // ── setDrawRange based on displayT ────────────────────────────────────────
    const applyRange = (ref, timesArr, countRef) => {
      const geo = ref.current?.geometry
      if (!geo) return
      const n   = countRef.current
      const vis = (!shared.maxT || displayT >= shared.maxT)
        ? n : upperBound(timesArr.current, displayT, n)
      geo.setDrawRange(0, vis * 2)
    }
    applyRange(axonRef, axonTimes, axonCount)
    applyRange(dendRef, dendTimes, dendCount)

    // ── Camera fit ────────────────────────────────────────────────────────────
    const now = Date.now()
    if ((!camFitted.current && ns > 0) || (now - lastFit.current > 8000 && ns > 4)) {
      const b = percentileBounds(somas)
      if (b) {
        const dist = b.size * 2.4
        if (!camFitted.current) {
          camera.position.set(b.cx + dist*0.5, b.cy + dist*0.4, b.cz + dist)
          camera.lookAt(b.cx, b.cy, b.cz)
        }
        camera.near = dist * 0.001
        camera.far  = Math.max(dist * 60, ext * 30)
        camera.updateProjectionMatrix()
        camFitted.current = true; lastFit.current = now
      }
    }
  })

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 3]} intensity={1.2} />
      <directionalLight position={[-2, 1, -2]} intensity={0.35} color="#6688cc" />
      <pointLight position={[0, -2, 0]} intensity={0.2} color="#ffaa55" />
    </>
  )
}

// ── Constants matching bio_constants.jl ───────────────────────────────────────
const N_STRUCT = 100  // electrical steps per structural step

// ── Info panel ────────────────────────────────────────────────────────────────
function SomaInfoPanel({ soma, onClose, serverUrl, onSelectSoma, sharedRef,
                         fireHistoryRef, rateWindow, setRateWindow }) {
  const [synData, setSynData]       = useState(null)
  const [synLoading, setSynLoading] = useState(false)
  const [showOut, setShowOut]       = useState(false)
  const [showIn, setShowIn]         = useState(false)

  // Fetch synapses when selected soma changes
  useEffect(() => {
    if (!soma?.nid) { setSynData(null); return }
    setSynLoading(true)
    fetch(`${serverUrl}/api/synapses?nid=${soma.nid}`,
          { signal: AbortSignal.timeout(4000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setSynData(data); setSynLoading(false) })
      .catch(() => { setSynData(null); setSynLoading(false) })
  }, [soma?.nid, serverUrl])

  if (!soma) return null

  // Look up LIVE soma data each render — the `soma` prop is a click-time
  // snapshot that never updates. sharedRef.current.somas is refreshed every
  // poll, and the parent re-renders us via setStats on each poll.
  const liveSomas = sharedRef?.current?.somas ?? []
  const live = liveSomas.find(s => s.nid === soma.nid) ?? soma

  // Compute windowed average fire rate from history
  const history = fireHistoryRef?.current?.[soma.nid] ?? []
  const window = Math.min(rateWindow, history.length)
  const recent = history.slice(-window)
  const totalFires = recent.reduce((s, h) => s + (h.fc ?? 0), 0)
  const avgRate = window > 0 ? totalFires / (window * N_STRUCT) : 0

  const selectPartner = (nid) => {
    const somas = sharedRef?.current?.somas ?? []
    const match = somas.find(s => s.nid === nid)
    if (match) onSelectSoma(match)
  }

  const rowStyle = {display:'flex',justifyContent:'space-between',marginBottom:3}
  const dimStyle = {color:'var(--text-dim)'}
  const valStyle = {color:'var(--text-secondary)'}

  const outCount = synData?.outgoing?.length ?? 0
  const inCount  = synData?.incoming?.length ?? 0

  return (
    <div style={{
      position:'absolute', top:10, right:10,
      background:'rgba(18,18,18,0.96)',
      border:`1px solid ${(live.firing??0)>0.01?'var(--accent-amber)':'var(--border-mid)'}`,
      borderRadius:'var(--radius-md)', padding:'10px 12px', minWidth:200, maxWidth:280,
      maxHeight:'calc(100vh - 120px)', overflowY:'auto',
      fontSize:11, fontFamily:'var(--font-mono)', pointerEvents:'all',
    }}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <b style={{color:'var(--text-primary)'}}>{soma.nid ?? '?'}…</b>
        <button className="ns-btn icon-only" style={{fontSize:11}} onClick={onClose}>✕</button>
      </div>

      {/* Basic info */}
      {[['status',   live.d ? 'dormant' : (live.firing??0)>0.01 ? 'firing' : 'active'],
        ['health',   `${Math.round((live.h??0)*100)}%`],
        ['radius',   `${((live.r??0)*1000).toFixed(1)} µm`],
        ['pos',      live.pos?.map(v=>v.toFixed(2)).join(', ') ?? '—'],
      ].map(([k,v]) => (
        <div key={k} style={rowStyle}>
          <span style={dimStyle}>{k}</span>
          <span style={valStyle}>{v}</span>
        </div>
      ))}

      {/* Fire rate section */}
      <div style={{borderTop:'1px solid var(--border-dim)',marginTop:6,paddingTop:6}}>
        <div style={rowStyle}>
          <span style={dimStyle}>rate (inst)</span>
          <span style={valStyle}>{((live.firing??0)*1000).toFixed(1)} Hz</span>
        </div>
        <div style={rowStyle}>
          <span style={dimStyle}>rate (avg)</span>
          <span style={{color:'var(--accent-blue)'}}>{(avgRate*1000).toFixed(1)} Hz</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:4}}>
          <span style={dimStyle}>window</span>
          <select className="ns-select" style={{fontSize:10,padding:'1px 3px',width:70}}
                  value={rateWindow}
                  onChange={e => setRateWindow(Number(e.target.value))}>
            {[1,5,10,25,50,100].map(n =>
              <option key={n} value={n}>{n} steps</option>
            )}
          </select>
        </div>
      </div>

      {/* Synapses section */}
      {synLoading && <div style={{color:'var(--text-dim)',marginTop:6}}>loading synapses…</div>}
      {synData && (
        <div style={{borderTop:'1px solid var(--border-dim)',marginTop:6,paddingTop:6}}>
          {/* Outgoing */}
          <div style={{cursor:'pointer',marginBottom:4,color:'var(--text-primary)'}}
               onClick={() => setShowOut(v => !v)}>
            {showOut ? '▾' : '▸'} Outgoing ({outCount})
          </div>
          {showOut && synData.outgoing?.map((syn, i) => (
            <div key={`o${i}`} style={{marginLeft:8,marginBottom:3}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{color:'var(--accent-blue)',cursor:'pointer',textDecoration:'underline'}}
                      onClick={() => selectPartner(syn.partner)}>
                  {syn.partner}
                </span>
                <span style={dimStyle}>{syn.axosomatic ? 'axo' : 'den'}</span>
                <span style={{flex:1}} />
                <span style={valStyle}>{syn.weight.toFixed(4)}</span>
              </div>
              <div style={{height:3,background:'var(--border-dim)',borderRadius:2,marginTop:2}}>
                <div style={{height:'100%',borderRadius:2,
                             background:'var(--accent-blue)',
                             width:`${Math.min(100, syn.weight * 1000)}%`}} />
              </div>
            </div>
          ))}

          {/* Incoming */}
          <div style={{cursor:'pointer',marginBottom:4,marginTop:6,color:'var(--text-primary)'}}
               onClick={() => setShowIn(v => !v)}>
            {showIn ? '▾' : '▸'} Incoming ({inCount})
          </div>
          {showIn && synData.incoming?.map((syn, i) => (
            <div key={`i${i}`} style={{marginLeft:8,marginBottom:3}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{color:'#f04040',cursor:'pointer',textDecoration:'underline'}}
                      onClick={() => selectPartner(syn.partner)}>
                  {syn.partner}
                </span>
                <span style={dimStyle}>{syn.axosomatic ? 'axo' : 'den'}</span>
                <span style={{flex:1}} />
                <span style={valStyle}>{syn.weight.toFixed(4)}</span>
              </div>
              <div style={{height:3,background:'var(--border-dim)',borderRadius:2,marginTop:2}}>
                <div style={{height:'100%',borderRadius:2,
                             background:'#f04040',
                             width:`${Math.min(100, syn.weight * 1000)}%`}} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SimViewer({ serverUrl = '' }) {
  const [status,     setStatus]     = useState('idle')
  const [stats,      setStats]      = useState(null)
  const [maxT,       setMaxT]       = useState(0)
  const [displayT,   setDisplayT]   = useState(0)
  const [liveLocked, setLiveLocked] = useState(true)
  const [playing,    setPlaying]    = useState(false)
  const [playSpeed,  setPlaySpeed]  = useState(10)
  const [somaScale,  setSomaScale]  = useState(1.0)
  const [showAxons,  setShowAxons]  = useState(true)
  const [showDends,  setShowDends]  = useState(true)
  const [loadPct,    setLoadPct]    = useState(null)
  const [selected,   setSelected]   = useState(null)
  const [dimFactor,  setDimFactor]  = useState(0.15)
  const [rateWindow, setRateWindow] = useState(10)

  const sharedRef    = useRef({ somas:[], extent:1.0, maxT:0, pendingSegs:[],
                                loadQueue:null, pendingResync:null, lastResyncT:0 })
  const fireHistoryRef = useRef({})
  const lastRetractNRef = useRef(0)
  const somaScaleRef = useRef(1.0)
  const displayTRef  = useRef(0)
  const selectedRef  = useRef(null)
  const dimFactorRef = useRef(0.15)
  const timerRef     = useRef(null)
  const playTimerRef = useRef(null)
  const liveTRef     = useRef(0)
  const liveLockRef  = useRef(true)

  useEffect(() => { somaScaleRef.current = somaScale  }, [somaScale])
  useEffect(() => { displayTRef.current  = displayT   }, [displayT])
  useEffect(() => { liveLockRef.current  = liveLocked }, [liveLocked])
  useEffect(() => { selectedRef.current  = selected   }, [selected])
  useEffect(() => { dimFactorRef.current = dimFactor  }, [dimFactor])

  // Load trajectory history — builds a full Float32Array snapshot and stages
  // it as `pendingResync`. The Scene's useFrame swaps it in atomically (single
  // frame, no flicker). Used both for initial start AND for retraction-event
  // resyncs (poll() schedules this when model.retract_n increases).
  const loadTrajectories = useCallback(async () => {
    setLoadPct(0)
    try {
      const res = await fetch(`${serverUrl}/api/trajectories`,
        { signal: AbortSignal.timeout(60000) })
      if (!res.ok) { setLoadPct(null); return }
      const data = await res.json()
      const segs = data.segs ?? []
      segs.sort((a,b) => (a[8]??0) - (b[8]??0))   // sort by t_step (element [8])
      setLoadPct(60)

      // Partition by axon/dend (s[6]==1 for axon)
      const axonSegs = []
      const dendSegs = []
      for (const s of segs) (s[6] === 1 ? axonSegs : dendSegs).push(s)
      if (axonSegs.length > MAX_SEGS) axonSegs.length = MAX_SEGS
      if (dendSegs.length > MAX_SEGS) dendSegs.length = MAX_SEGS

      const buildResync = (segArr, br, bg, bb) => {
        const n = segArr.length
        const pos   = new Float32Array(n * 6)
        const col   = new Float32Array(n * 6)
        const times = new Float32Array(n)
        const nids  = new Float32Array(n)
        for (let i = 0; i < n; i++) {
          const s = segArr[i]
          const p = i * 6
          pos[p]=s[0]; pos[p+1]=s[1]; pos[p+2]=s[2]
          pos[p+3]=s[3]; pos[p+4]=s[4]; pos[p+5]=s[5]
          col[p]=br;    col[p+1]=bg;   col[p+2]=bb
          col[p+3]=br;  col[p+4]=bg;   col[p+5]=bb
          nids[i]  = s[7] ?? -1
          times[i] = s[8] ?? 0
        }
        return { pos, col, times, nids, count: n }
      }

      const shared = sharedRef.current
      shared.pendingResync = {
        axon: buildResync(axonSegs, AXON_R, AXON_G, AXON_B),
        dend: buildResync(dendSegs, DEND_R, DEND_G, DEND_B),
        t:    data.max_t ?? 0,
      }
      shared.nidMap = data.nid_map ?? {}

      const newMax = data.max_t ?? 0
      shared.extent = data.extent ?? shared.extent
      shared.maxT   = Math.max(shared.maxT, newMax)
      liveTRef.current = newMax
      setMaxT(m => Math.max(m, newMax))
      if (liveLockRef.current) { setDisplayT(newMax); displayTRef.current = newMax }
      setLoadPct(null)
    } catch(e) {
      console.warn('loadTrajectories:', e); setLoadPct(null)
    }
  }, [serverUrl])

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${serverUrl}/api/state`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return
      const data = await res.json()
      const s = sharedRef.current
      s.somas  = data.somas  ?? []
      s.extent = data.extent ?? s.extent
      // Filter out segs that predate the last full-resync to avoid duplicates
      // (resync's snapshot already contains everything up through resync.t).
      if (data.segs?.length > 0) {
        const cutoff = s.lastResyncT ?? 0
        for (const seg of data.segs) {
          if ((seg[8] ?? 0) > cutoff) s.pendingSegs.push(seg)
        }
      }
      // Retraction event → schedule a full trajectory resync. Cheap because
      // it only fires when the backend actually popped a waypoint.
      const newRetractN = data.retract_n ?? 0
      if (newRetractN > lastRetractNRef.current) {
        lastRetractNRef.current = newRetractN
        loadTrajectories()
      }
      const t = data.t ?? 0
      liveTRef.current = t; s.maxT = Math.max(s.maxT, t)
      setMaxT(m => Math.max(m, t))

      // Accumulate fire count history for windowed average
      const fh = fireHistoryRef.current
      for (const soma of s.somas) {
        if (!soma.nid) continue
        if (!fh[soma.nid]) fh[soma.nid] = []
        const hist = fh[soma.nid]
        // Only push if we moved to a new structural step
        if (hist.length === 0 || hist[hist.length - 1].t !== t) {
          hist.push({ t, fc: soma.fc ?? 0 })
          if (hist.length > 200) hist.shift()
        }
      }
      if (liveLockRef.current) { setDisplayT(t); displayTRef.current = t }
      setStats({ t, somas: s.somas.length, cones: (data.cones??[]).length,
                 syns: typeof data.syns === 'number' ? data.syns : (data.syns??[]).length })
    } catch {}
  }, [serverUrl, loadTrajectories])

  useEffect(() => {
    if (!playing) { clearInterval(playTimerRef.current); return }
    const step = Math.max(1, Math.round(playSpeed))
    playTimerRef.current = setInterval(() => {
      setDisplayT(t => {
        const next = t + step
        if (next >= liveTRef.current) { setPlaying(false); return liveTRef.current }
        displayTRef.current = next; return next
      })
    }, 1000 / 30)
    return () => clearInterval(playTimerRef.current)
  }, [playing, playSpeed])

  const start = useCallback(async () => {
    const s = sharedRef.current
    s.pendingSegs = []; s.loadQueue = null
    s.pendingResync = null; s.lastResyncT = 0
    s.somas = []; s.maxT = 0; s.extent = 1.0
    fireHistoryRef.current = {}
    lastRetractNRef.current = 0
    setStatus('live'); setStats(null); setMaxT(0); setDisplayT(0)
    setLiveLocked(true); setPlaying(false); liveLockRef.current = true
    setSelected(null)
    poll()
    timerRef.current = setInterval(poll, POLL_MS)
    loadTrajectories()
  }, [poll, loadTrajectories])

  const stop = useCallback(() => {
    clearInterval(timerRef.current); clearInterval(playTimerRef.current)
    setStatus('idle'); setPlaying(false)
  }, [])

  useEffect(() => () => {
    clearInterval(timerRef.current); clearInterval(playTimerRef.current)
  }, [])

  const isLive = status === 'live'

  return (
    <div style={{ position:'absolute', inset:0, display:'flex',
                  flexDirection:'column', background:'#0a0a09' }}>

      <div style={{ flexShrink:0, padding:'6px 10px',
                    borderBottom:'1px solid var(--border-strong)',
                    display:'flex', alignItems:'center', gap:8,
                    background:'var(--bg-surface)' }}>
        <span style={{ flex:1, fontSize:10, fontWeight:700, letterSpacing:'0.08em',
                       textTransform:'uppercase', color:'var(--text-dim)' }}>Viewer</span>
        {isLive
          ? <button className="ns-btn" style={{fontSize:11}} onClick={stop}>Stop</button>
          : <button className="ns-btn primary" style={{fontSize:11}} onClick={start}>Connect</button>
        }
      </div>

      {stats && (
        <div style={{ flexShrink:0, padding:'3px 10px',
                      borderBottom:'1px solid var(--border-dim)',
                      fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text-secondary)',
                      display:'flex', gap:12, background:'var(--bg-elevated)' }}>
          <span>t=<b style={{color:'var(--text-primary)'}}>{stats.t}</b></span>
          <span>somas <b style={{color:'var(--text-primary)'}}>{stats.somas}</b></span>
          <span>cones <b style={{color:'var(--text-primary)'}}>{stats.cones}</b></span>
          <span>syns <b style={{color:'var(--text-primary)'}}>{stats.syns}</b></span>
          {loadPct !== null &&
            <span style={{color:'var(--accent-amber)'}}>⟳ {loadPct}%</span>}
        </div>
      )}

      {isLive && (
        <div style={{ flexShrink:0, padding:'5px 10px',
                      borderBottom:'1px solid var(--border-dim)',
                      background:'var(--bg-surface)', display:'flex',
                      flexDirection:'column', gap:5 }}>
          {maxT > 0 && (
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              <button className="ns-btn"
                style={{fontSize:13,padding:'1px 7px',minWidth:28}}
                onClick={() => { setPlaying(p=>!p); if(liveLocked) setLiveLocked(false) }}>
                {playing ? '⏸' : '▶'}
              </button>
              <select className="ns-select"
                style={{fontSize:10,padding:'2px 3px',width:58}}
                value={playSpeed}
                onChange={e => setPlaySpeed(Number(e.target.value))}>
                {[1,5,10,25,50,100].map(s=><option key={s} value={s}>{s}×</option>)}
              </select>
              <input type="range" className="ns-slider"
                min={0} max={maxT} step={1} value={displayT}
                style={{flex:1}}
                onChange={e => {
                  const t = Number(e.target.value)
                  setDisplayT(t); displayTRef.current = t
                  setLiveLocked(false); liveLockRef.current = false
                  setPlaying(false)
                }} />
              <span style={{fontSize:10,fontFamily:'var(--font-mono)',
                            color:'var(--text-dim)',whiteSpace:'nowrap'}}>
                {displayT}/{maxT}
              </span>
              <button className="ns-btn"
                style={{fontSize:10,padding:'2px 7px',
                        borderColor:liveLocked?'var(--accent-blue)':'var(--border-mid)',
                        color:liveLocked?'var(--accent-blue)':'var(--text-dim)'}}
                onClick={() => {
                  setLiveLocked(true); setPlaying(false)
                  setDisplayT(liveTRef.current); displayTRef.current = liveTRef.current
                }}>⊙</button>
            </div>
          )}
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:10,color:'var(--text-dim)',whiteSpace:'nowrap'}}>Soma ×</span>
            <input type="range" className="ns-slider"
              min={0.1} max={8} step={0.05} value={somaScale}
              style={{width:80}}
              onChange={e => { const v=Number(e.target.value); setSomaScale(v); somaScaleRef.current=v }} />
            <span style={{fontSize:10,fontFamily:'var(--font-mono)',
                          color:'var(--text-secondary)',minWidth:28}}>
              {somaScale.toFixed(1)}
            </span>
            <span style={{fontSize:10,color:'var(--text-dim)',whiteSpace:'nowrap',marginLeft:4}}>Dim</span>
            <input type="range" className="ns-slider"
              min={0} max={1} step={0.01} value={dimFactor}
              style={{width:60}}
              onChange={e => { const v=Number(e.target.value); setDimFactor(v); dimFactorRef.current=v }} />
            <span style={{fontSize:10,fontFamily:'var(--font-mono)',
                          color:'var(--text-secondary)',minWidth:28}}>
              {dimFactor.toFixed(2)}
            </span>
            <div style={{flex:1}} />
            {[['axon','Axons',showAxons,setShowAxons,'#3a9ffa'],
              ['dend','Dendrites',showDends,setShowDends,'#f04040']].map(
              ([k,label,vis,setV,col]) => (
                <button key={k} className="ns-btn"
                  style={{fontSize:10,padding:'2px 8px',
                          borderColor:vis?col:'var(--border-dim)',
                          color:vis?col:'var(--text-dim)',
                          background:vis?col+'18':'transparent'}}
                  onClick={()=>setV(v=>!v)}>
                  {label}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {(!isLive || !stats) ? (
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',
                     fontSize:11,color:'var(--text-dim)',textAlign:'center',lineHeight:1.8}}>
          Run a simulation, then click{' '}
          <b style={{color:'var(--text-secondary)',margin:'0 4px'}}>Connect</b>.
        </div>
      ) : (
        <div style={{flex:1,position:'relative'}}>
          <Canvas
            camera={{position:[0.5,0.5,2],fov:50,near:1e-5,far:10000}}
            gl={{antialias:true,logarithmicDepthBuffer:true}}
            style={{position:'absolute',inset:0}}
          >
            <SimScene
              sharedRef={sharedRef} somaScaleRef={somaScaleRef}
              displayTRef={displayTRef} showAxons={showAxons}
              showDends={showDends} onSelectSoma={setSelected}
              selectedRef={selectedRef} dimFactorRef={dimFactorRef}
            />
            <OrbitControls enableDamping dampingFactor={0.1}
              mouseButtons={{LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.PAN}} />
          </Canvas>
          <SomaInfoPanel soma={selected} onClose={()=>setSelected(null)}
            serverUrl={serverUrl} onSelectSoma={setSelected} sharedRef={sharedRef}
            fireHistoryRef={fireHistoryRef} rateWindow={rateWindow} setRateWindow={setRateWindow} />
          <div style={{position:'absolute',bottom:10,left:10,
                       background:'rgba(10,10,9,0.90)',border:'1px solid var(--border-mid)',
                       borderRadius:'var(--radius-sm)',padding:'5px 9px',
                       fontSize:10,fontFamily:'var(--font-mono)',
                       color:'var(--text-dim)',lineHeight:2.0,pointerEvents:'none'}}>
            <div><span style={{color:'#3a9ffa'}}>━</span> axon</div>
            <div><span style={{color:'#f04040'}}>━</span> dendrite</div>
            <div><span style={{color:'#30c060'}}>●</span> healthy</div>
            <div><span style={{color:'#f0e020'}}>●</span> firing</div>
            <div><span style={{color:'#d08020'}}>●</span> stressed</div>
            <div style={{color:'var(--text-dim)',marginTop:4}}>click soma to inspect</div>
          </div>
        </div>
      )}
    </div>
  )
}
