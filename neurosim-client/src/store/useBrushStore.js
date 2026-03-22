// store/useBrushStore.js

import { create } from 'zustand'

const useBrushStore = create((set) => ({
  // ── Brush mode ─────────────────────────────────────────────────────────────
  // point   — single precise neuron per click
  // area    — drag to paint bulk region (batched commit on mouse-up)
  // carve   — drag sphere to erase bulk positions
  // promote — drag sphere to pull bulk positions into precise neurons
  // erase   — removes precise neurons under cursor
  // select  — click to select precise neuron or region
  mode: 'area',

  // ── Shared geometry ────────────────────────────────────────────────────────
  brushRadius:  2.0,

  // ── Area brush ─────────────────────────────────────────────────────────────
  density:      0.06,
  jitterAmount: 0.85,

  // ── Neuron identity (used by both point and area) ──────────────────────────
  morphology:   'generic',
  neuriteCount: 1,
  releases:     null,
  attracts:     null,
  repels:       null,

  // ── Chemical brush ─────────────────────────────────────────────────────────
  chemical: {
    name:     'BDNF',
    sigma:    3.0,
    strength: 1.0,
  },

  // ── Pointer state ──────────────────────────────────────────────────────────
  cursorPos:   null,
  isPainting:  false,

  // ── Setters ────────────────────────────────────────────────────────────────
  setMode(mode)         { set({ mode }) },
  setBrushRadius(v)     { set({ brushRadius: v }) },
  setDensity(v)         { set({ density: v }) },
  setJitter(v)          { set({ jitterAmount: v }) },
  setMorphology(v)      { set({ morphology: v }) },
  setNeuriteCount(v)    { set({ neuriteCount: v }) },
  setChemical(patch)    { set(s => ({ chemical: { ...s.chemical, ...patch } })) },
  setCursorPos(pos)     { set({ cursorPos: pos }) },
  setIsPainting(v)      { set({ isPainting: v }) },
}))

export default useBrushStore
