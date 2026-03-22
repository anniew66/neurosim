// lib/simApi.js
// HTTP client for the Julia neurosim server.
// Merges precise neurons (useSceneStore) + expanded bulk regions (useRegionStore)
// into the Julia full-format JSON before sending.

const BASE = '/api'

export function sceneToJuliaConfig(preciseNeurons, regionNeurons, chemicals, globalParams = {}) {
  const allNeurons = [...preciseNeurons, ...regionNeurons]
  const neuronsObj = {}

  for (const n of allNeurons) {
    neuronsObj[n.id] = {
      soma:           n.soma,
      morphology:     n.morphology,
      releases:       n.releases,
      attracts:       n.attracts,
      repels:         n.repels,
      branch_prob:    n.branch_prob,
      max_branch_len: n.max_branch_len,
      neurites:       (n.neurites && n.neurites.length > 0 ? n.neurites : [{ azimuth: 0, elevation: 0 }]).map(nt => [nt.azimuth ?? 0, nt.elevation ?? 0]),
    }
  }

  const chemObj    = {}
  const nameCounts = {}
  for (const c of chemicals) {
    const count = (nameCounts[c.name] ?? 0)
    nameCounts[c.name] = count + 1
    const key = count === 0 ? c.name : `${c.name}_${count}`
    chemObj[key] = { source: c.source, sigma: c.sigma, strength: c.strength }
  }

  return {
    neurons: neuronsObj,
    global_chemicals: chemObj,
    params: {
      seed:           globalParams.seed           ?? 1,
      extent:         globalParams.extent         ?? 120.0,
      step_size:      globalParams.step_size       ?? 1.5,
      chemotaxis:     globalParams.chemotaxis      ?? 3.0,
      random_walk:    globalParams.random_walk     ?? 0.5,
      synapse_radius: globalParams.synapse_radius  ?? 3.0,
      max_steps:      globalParams.max_steps       ?? 5000,
      run_id:         globalParams.run_id          ?? 1,
      vtk_dir:        globalParams.vtk_dir         ?? 'vtk_output',
      viz_csv:        globalParams.viz_csv         ?? 'simulation_viz.csv',
      analysis_csv:   globalParams.analysis_csv    ?? 'simulation_analysis.csv',
    },
  }
}

export async function runSimulation(preciseNeurons, regionNeurons, chemicals, globalParams = {}) {
  const config = sceneToJuliaConfig(preciseNeurons, regionNeurons, chemicals, globalParams)
  const resp = await fetch(`${BASE}/simulate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(config),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    throw new Error(err.error ?? `Server error ${resp.status}`)
  }
  return resp.json()
}

export async function checkHealth() {
  try {
    const resp = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) })
    return resp.ok
  } catch {
    return false
  }
}
