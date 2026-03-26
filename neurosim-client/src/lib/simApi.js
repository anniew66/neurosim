// lib/simApi.js
// HTTP client for the Julia neurosim server.
// Merges precise neurons (useSceneStore) + expanded bulk regions (useRegionStore)
// into the Julia full-format JSON before sending.

const BASE = '/api'

export function sceneToJuliaConfig(preciseNeurons, regionNeurons, chemicals, globalParams = {}, tissueDensity = null) {
  const allNeurons = [...preciseNeurons, ...regionNeurons]
  const neuronsObj = {}

  for (const n of allNeurons) {
    const entry = {
      soma:           n.soma,
      morphology:     n.morphology,
      releases:       n.releases,
      attracts:       n.attracts,
      repels:         n.repels,
      branch_prob:    n.branch_prob,
      max_branch_len: n.max_branch_len,
      neurites:       (n.neurites && n.neurites.length > 0 ? n.neurites : []).map(nt => [nt.azimuth ?? 0, nt.elevation ?? 0]),
      start_time:     n.start_time   ?? 0,
      is_input:       n.is_input     ?? false,
    }
    // Include input spec only for input neurons
    if (n.is_input) {
      entry.input = {
        mode:             n.input_mode     ?? 'rate',
        rate:             n.input_rate     ?? 0.1,
        sequence:         n.input_sequence ?? [],
        emit_chemicals:   n.input_emit_chemicals ?? false,
      }
    }
    neuronsObj[n.id] = entry
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
    tissue_density: tissueDensity,
    params: {
      seed:           globalParams.seed           ?? 1,
      extent:         globalParams.extent         ?? 120.0,
      step_size:      globalParams.step_size       ?? 1.5,
      chemotaxis:     globalParams.chemotaxis      ?? 1.0,   // reduced: prevents single-attractor lock-in
      random_walk:    globalParams.random_walk     ?? 1.2,   // increased: more exploratory growth
      synapse_radius: globalParams.synapse_radius  ?? 3.0,
      max_steps:      globalParams.max_steps       ?? 5000,
      run_id:         globalParams.run_id          ?? 1,
      vtk_dir:        globalParams.vtk_dir          ?? 'vtk_output',
      viz_csv:        globalParams.viz_csv          ?? 'simulation_viz.csv',
      analysis_csv:   globalParams.analysis_csv     ?? 'simulation_analysis.csv',
      synapse_csv:    globalParams.synapse_csv       ?? 'synapses.csv',
      health_decay_rate:    globalParams.health_decay_rate    ?? 0.0002,
      death_threshold:      globalParams.death_threshold      ?? 0.05,
      synapse_health_boost: globalParams.synapse_health_boost ?? 0.4,
      prune_delay:          globalParams.prune_delay          ?? 5000,
      n_struct:             globalParams.n_struct             ?? 100,
    },
  }
}

export async function runSimulation(preciseNeurons, regionNeurons, chemicals, globalParams = {}, tissueDensity = null) {
  const config = sceneToJuliaConfig(preciseNeurons, regionNeurons, chemicals, globalParams, tissueDensity)
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
