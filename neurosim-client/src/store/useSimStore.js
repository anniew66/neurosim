// store/useSimStore.js
// Tracks the simulation run lifecycle: idle → running → done / error.
// Also holds the last result summary returned by the Julia server.

import { create } from 'zustand'
import { runSimulation, checkHealth } from '../lib/simApi.js'
import useRegionStore from './useRegionStore.js'
import useSceneStore from './useSceneStore.js'

const useSimStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────────────────────────
  status:       'idle',   // 'idle' | 'running' | 'done' | 'error'
  result:       null,     // last successful result from Julia
  error:        null,     // last error message string
  serverOnline: null,     // null = unknown, true/false

  // ── Global sim params (mirrors Julia params block) ─────────────────────────
  params: {
    seed:           1,
    extent:         120.0,
    step_size:      1.5,
    chemotaxis:     3.0,
    random_walk:    0.5,
    synapse_radius: 3.0,
    max_steps:      5000,
    run_id:         1,
    vtk_dir:        'vtk_output',
    viz_csv:        'simulation_viz.csv',
    analysis_csv:   'simulation_analysis.csv',
  },

  updateParam(key, value) {
    set(s => ({ params: { ...s.params, [key]: value } }))
  },

  // ── Actions ────────────────────────────────────────────────────────────────
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
      const result = await runSimulation(preciseNeurons, regionNeurons, chemicals, get().params)
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
