# src/structs.jl
# All composite type definitions. Depends on bio_constants.jl.

using Agents
using StaticArrays

# ── Input specification ───────────────────────────────────────────────────────
struct InputSpec
    mode       :: Symbol        # :rate or :sequence
    rate       :: Float64       # fires-per-electrical-step probability (rate mode)
    sequence   :: Vector{Bool}  # explicit pattern (sequence mode), repeats
    emit_chems :: Bool          # whether to emit chemicals (false for most inputs)
end

InputSpec() = InputSpec(:rate, 0.0, Bool[], false)

# ── Agents ────────────────────────────────────────────────────────────────────

# GrowthCone: tip of a neurite (axon or dendrite).
# Multiple provisional synapses are allowed simultaneously (competition model).
@agent struct GrowthCone(ContinuousAgent{3,Float64})
    neuron_id    :: String
    neurite_idx  :: Int        # index into NeuronRecord.neurites (1-based)
    branch_idx   :: Int        # 0 = primary shaft, >0 = interstitial branch id
    is_axon      :: Bool
    n_synapses   :: Int        # active synapse contacts (provisional + stable)
    branch_len   :: Float64    # path length from soma (mm)
    retracted    :: Bool       # cone has retracted fully → pending removal
    attract_chems:: Vector{String}
    repel_chems  :: Vector{String}
    # Per-cone trajectory used for branched cones (branch_idx > 0). Primary
    # cones (branch_idx == 0) still use NeuriteSpec.trajectory on the
    # NeuronRecord, which is shared across the soma's primary shaft.
    branch_trajectory :: Vector{Tuple{Int,SVector{3,Float64}}}
end

# Soma: cell body. Electrical state stored externally in model.neuron_elec.
@agent struct Soma(ContinuousAgent{3,Float64})
    neuron_id    :: String
    morphology   :: String
    health       :: Float64
    soma_radius  :: Float64    # mm, updated each structural step
    n_stable_syn :: Int        # stable (not just provisional) synapses
    dormant      :: Bool       # true while start_time has not been reached
end

# ── NeuriteSpec ───────────────────────────────────────────────────────────────
struct NeuriteSpec
    azimuth_deg   :: Float64
    elevation_deg :: Float64
    is_axon       :: Bool
    trajectory    :: Vector{Tuple{Int,SVector{3,Float64}}}   # (struct_step, pos) pairs
end

# ── NeuronRecord (not an agent — stored in model.neurons) ─────────────────────
mutable struct NeuronRecord
    id               :: String
    soma_pos         :: SVector{3,Float64}
    morphology       :: String
    releases         :: Vector{String}
    attracts         :: Vector{String}
    repels           :: Vector{String}
    neurites         :: Vector{NeuriteSpec}
    branch_prob      :: Float64
    L_target         :: Float64       # equilibrium neurite length (mm)
    soma_radius_base :: Float64       # mm
    start_time       :: Int           # structural step at which neuron activates
    is_input         :: Bool
    input_spec       :: InputSpec
    theta_ltd        :: Float64       # BCM LTD threshold
    theta_ltp        :: Float64       # BCM LTP threshold
    k_stab           :: Float64       # stability → LTD-threshold coupling
    prune_delay      :: Int           # structural steps weak before pruning
    axon_dir         :: Union{Nothing, SVector{3,Float64}}  # direction soma→axon tip (set on first axon sprout)
end

# ── Per-neuron electrical state ───────────────────────────────────────────────
# Stored in model.neuron_elec::Dict{String,NeuronElecState}, keyed by neuron_id.
mutable struct NeuronElecState
    V          :: Float64       # membrane potential (normalised, 0 = rest)
    refractory :: Int           # steps remaining in refractory period
    H          :: Vector{Bool}  # ring buffer of firing history (length W_STDP_POST)
    H_ptr      :: Int           # current write index
    fired      :: Bool          # fired in most recent electrical step
    fire_rate  :: Float64       # recent firing rate (used for chemical release)
    fire_count :: Int           # fires accumulated this substep block
    seq_ptr    :: Int           # sequence playback pointer (sequence input only)
end

function NeuronElecState()
    NeuronElecState(0.0, 0, fill(false, W_STDP_POST), 1, false, 0.0, 0, 1)
end

# Helper: did neuron fire at relative offset `lag` steps ago?
function fired_at(state::NeuronElecState, lag::Int)::Bool
    buf = state.H
    n   = length(buf)
    idx = mod1(state.H_ptr - lag, n)   # H_ptr points to most-recent
    buf[idx]
end

# ── Synapse record ────────────────────────────────────────────────────────────
# One record per provisional/stable synapse.
# Stored in model.synapses::Dict{Int,SynapseRecord}.
mutable struct SynapseRecord
    id              :: Int
    pre_neuron_id   :: String
    post_neuron_id  :: String
    pre_gc_id       :: Int          # presynaptic GrowthCone agent id
    post_gc_id      :: Int          # postsynaptic GrowthCone (or Soma) agent id
    is_axosomatic   :: Bool         # true if post is a Soma, not a GrowthCone
    size            :: Float64      # µm² active zone area
    distance        :: Float64      # path distance from post soma (mm)
    attenuation     :: Float64      # exp(-d/λ_elec) — precomputed
    tau_syn         :: Float64      # ms — synaptic time constant, precomputed
    V_syn           :: Float64      # current synaptic potential contribution
    c_i             :: Float64      # instantaneous NMDA calcium proxy
    c_bar           :: Float64      # running avg calcium (W_CALCIUM steps)
    sigma_stab      :: Float64      # slow stability average (W_STABILITY steps)
    k_weak          :: Int          # consecutive structural steps with s < S_MIN_VIABLE
end

function SynapseRecord(id, pre_nid, post_nid, pre_gc, post_gc, is_axosomatic, distance)
    att   = exp(-distance / LAMBDA_ELEC)
    tau   = TAU_SYN_BASE * (1.0 + distance / LAMBDA_DISP)
    SynapseRecord(id, pre_nid, post_nid, pre_gc, post_gc, is_axosomatic,
                  S_INIT, distance, att, tau,
                  0.0, 0.0, 0.0, 0.0, 0)
end

# ── Struct-of-arrays for electrical hot path ──────────────────────────────────
# Mirrors NeuronElecState and SynapseRecord as contiguous vectors for the 100
# electrical substeps.  Built from Dicts before the substep block, written back
# after.  Eliminates per-synapse Dict lookups and exp() calls in the inner loop.
mutable struct ElecArrays
    # ── Neuron dimension (N) ─────────────────────────────────────────
    n_neurons       :: Int
    V               :: Vector{Float64}       # membrane potential
    refractory      :: Vector{Int}           # refractory countdown
    fired           :: Vector{Bool}          # fired this step
    fire_rate       :: Vector{Float64}       # firing rate (fires/N_STRUCT)
    fire_count      :: Vector{Int}           # fires this substep block
    is_input        :: Vector{Bool}          # true for input neurons
    is_active       :: Vector{Bool}          # false if dormant/dead/missing
    seq_ptr         :: Vector{Int}           # sequence playback pointer

    # Input specs (valid only where is_input[i])
    input_mode      :: Vector{Symbol}        # :rate or :sequence
    input_rate      :: Vector{Float64}       # rate-mode probability
    input_seq       :: Vector{Vector{Bool}}  # sequence patterns

    # Index mapping
    nid_to_idx      :: Dict{String,Int}
    idx_to_nid      :: Vector{String}

    # ── Synapse dimension (S) ────────────────────────────────────────
    n_synapses      :: Int
    pre_idx         :: Vector{Int}           # index into neuron arrays
    post_idx        :: Vector{Int}           # index into neuron arrays
    syn_size        :: Vector{Float64}       # mutable by BCM
    attenuation     :: Vector{Float64}       # immutable after creation
    decay           :: Vector{Float64}       # precomputed exp(-DT/tau_syn)
    V_syn           :: Vector{Float64}       # synaptic potential integrator
    c_i             :: Vector{Float64}       # instantaneous NMDA calcium
    c_bar           :: Vector{Float64}       # running avg calcium
    sigma_stab      :: Vector{Float64}       # slow stability average

    # Synapse index mapping
    sid_to_idx      :: Dict{Int,Int}
    idx_to_sid      :: Vector{Int}

    # ── Scratch / LUT ────────────────────────────────────────────────
    V_input         :: Vector{Float64}       # [N] zeroed each LIF step
    nmda_lut        :: Vector{Float64}       # prebuilt sigmoid table
    _sid_buf        :: Vector{Int}           # reusable buffer for rebuild
end

function ElecArrays()
    ElecArrays(
        0,                                   # n_neurons
        Float64[], Int[], Bool[], Float64[], Int[], Bool[], Bool[], Int[],
        Symbol[], Float64[], Vector{Bool}[],
        Dict{String,Int}(), String[],
        0,                                   # n_synapses
        Int[], Int[], Float64[], Float64[], Float64[], Float64[],
        Float64[], Float64[], Float64[],
        Dict{Int,Int}(), Int[],
        Float64[],                           # V_input scratch
        build_nmda_lut(),                    # nmda_lut
        Int[],                               # _sid_buf
    )
end

# ── Tissue density grid ───────────────────────────────────────────────────────
# Flat 3D Float32 array. Evaluated via trilinear interpolation.
struct TissueDensityGrid
    data      :: Array{Float32,3}
    nx        :: Int
    ny        :: Int
    nz        :: Int
    origin    :: SVector{3,Float64}   # world position of corner (0,0,0) of grid
    cell_size :: Float64              # mm per cell (cubic)
end

function TissueDensityGrid(nx, ny, nz, origin, cell_size)
    TissueDensityGrid(zeros(Float32, nx, ny, nz), nx, ny, nz,
                      SVector{3,Float64}(origin...), cell_size)
end

function eval_density(grid::TissueDensityGrid, x, y, z)::Float64
    fx = (x - grid.origin[1]) / grid.cell_size + 1.0
    fy = (y - grid.origin[2]) / grid.cell_size + 1.0
    fz = (z - grid.origin[3]) / grid.cell_size + 1.0

    ix = clamp(floor(Int, fx), 1, grid.nx - 1)
    iy = clamp(floor(Int, fy), 1, grid.ny - 1)
    iz = clamp(floor(Int, fz), 1, grid.nz - 1)

    dx = clamp(fx - ix, 0.0, 1.0)
    dy = clamp(fy - iy, 0.0, 1.0)
    dz = clamp(fz - iz, 0.0, 1.0)

    d = grid.data
    Float64(
        d[ix,  iy,  iz  ]*(1-dx)*(1-dy)*(1-dz) + d[ix+1,iy,  iz  ]*dx*(1-dy)*(1-dz) +
        d[ix,  iy+1,iz  ]*(1-dx)*dy*(1-dz)     + d[ix+1,iy+1,iz  ]*dx*dy*(1-dz)     +
        d[ix,  iy,  iz+1]*(1-dx)*(1-dy)*dz     + d[ix+1,iy,  iz+1]*dx*(1-dy)*dz     +
        d[ix,  iy+1,iz+1]*(1-dx)*dy*dz         + d[ix+1,iy+1,iz+1]*dx*dy*dz
    )
end

# Paint a sphere of density into the grid
function paint_density!(grid::TissueDensityGrid, cx, cy, cz, radius, value)
    r2   = radius * radius
    imin = max(1, floor(Int, (cx - radius - grid.origin[1]) / grid.cell_size) + 1)
    imax = min(grid.nx, ceil(Int,  (cx + radius - grid.origin[1]) / grid.cell_size) + 1)
    jmin = max(1, floor(Int, (cy - radius - grid.origin[2]) / grid.cell_size) + 1)
    jmax = min(grid.ny, ceil(Int,  (cy + radius - grid.origin[2]) / grid.cell_size) + 1)
    kmin = max(1, floor(Int, (cz - radius - grid.origin[3]) / grid.cell_size) + 1)
    kmax = min(grid.nz, ceil(Int,  (cz + radius - grid.origin[3]) / grid.cell_size) + 1)

    for k in kmin:kmax, j in jmin:jmax, i in imin:imax
        wx = grid.origin[1] + (i - 1) * grid.cell_size
        wy = grid.origin[2] + (j - 1) * grid.cell_size
        wz = grid.origin[3] + (k - 1) * grid.cell_size
        if (wx-cx)^2 + (wy-cy)^2 + (wz-cz)^2 <= r2
            grid.data[i, j, k] = clamp(grid.data[i,j,k] + Float32(value), 0f0, 1f0)
        end
    end
end
