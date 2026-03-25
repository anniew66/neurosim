// store/useSimStore.js

import { create } from 'zustand'
import { runSimulation, checkHealth } from '../lib/simApi.js'
import useSceneStore  from './useSceneStore.js'
import useRegionStore        from './useRegionStore.js'
import useTissueDensityStore from './useTissueDensityStore.js'

const useSimStore = create((set, get) => ({
  status:       'idle',
  result:       null,
  error:        null,
  serverOnline: null,

  // ── Global sim params — all spatial values in mm ───────────────────────────
  params: {
    seed:                1,
    extent:              1.0,      // mm — default 1 mm cubic volume
    step_size:           0.003,    // mm — 3 µm per step
    chemotaxis:          3.0,
    random_walk:         0.5,
    synapse_radius:      0.003,    // mm — 3 µm contact zone
    max_steps:           5000,
    run_id:              1,
    vtk_dir:             'vtk_output',
    viz_csv:             'simulation_viz.csv',
    analysis_csv:        'simulation_analysis.csv',
    health_decay_rate:   0.0002,   // per step
    death_threshold:     0.05,     // health below this → neuron dies
    synapse_health_boost:0.4,      // health added per synapse formed
    // Electrical/structural timing
    n_struct:            100,          // electrical steps per structural step
    // BCM plasticity (global scale — per-morphology in Julia)
    eta_bcm:             0.0005,
    gamma_decay:         0.0008,
    // Pruning
    prune_delay:         5000,
  },

  updateParam(key, value) {
    set(s => ({ params: { ...s.params, [key]: value } }))
    // Keep density grid in sync with sim extent
    if (key === 'extent') {
      useTissueDensityStore.getState().syncToExtent(value)
    }
  },

  async run() {
    if (get().status === 'running') return
    const { neurons: preciseNeurons, chemicals } = useSceneStore.getState().exportScene()
    const regionNeurons = useRegionStore.getState().exportAsNeurons()
    const totalNeurons  = preciseNeurons.length + regionNeurons.length

    if (totalNeurons === 0) {
      set({ status: 'error', error: 'No neurons in scene. Paint some neurons first.' })
      return
    }

    set({ status: 'running', result: null, error: null })
    try {
      const densStore = useTissueDensityStore.getState()
      const tissueDensity = densStore.isEmpty() ? null : densStore.exportForJulia()
      const result = await runSimulation(preciseNeurons, regionNeurons, chemicals, get().params, tissueDensity)
      set({ status: 'done', result })
    } catch (e) {
      set({ status: 'error', error: e.message })
    }
  },

  async ping() {
    const online = await checkHealth()
    set({ serverOnline: online })
    return online
  },

  reset() {
    set({ status: 'idle', result: null, error: null })
  },
}))

export default useSimStore
