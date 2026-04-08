# bench_electrical.jl — Benchmark the SoA electrical substep path
#
# Tests three scenarios:
#   1. Full rebuild (first call / topology change)
#   2. Sync-only path (common case, no topology change)
#   3. Full 100-substep electrical_substeps! call
#
# Usage:  julia --project=. bench_electrical.jl [N_neurons] [N_synapses]

using Random, StaticArrays, OrderedCollections, BenchmarkTools

include("src/bio_constants.jl")
include("src/structs.jl")

# ── Minimal mock that satisfies build_elec_arrays! ───────────────────────────
# build_elec_arrays! accesses:
#   model.neurons        :: OrderedDict{String,NeuronRecord}
#   model.soma_agent_ids :: Dict{String,Int}
#   model[soma_id]       :: (something with .dormant field)
#
# We create a lightweight stand-in.

struct FakeSoma
    dormant :: Bool
end

struct FakeModel
    neurons        :: OrderedDict{String,NeuronRecord}
    soma_agent_ids :: Dict{String,Int}
    _somas         :: Dict{Int,FakeSoma}      # indexed by agent id
    neuron_elec    :: Dict{String,NeuronElecState}
    synapses       :: Dict{Int,SynapseRecord}
    rng            :: MersenneTwister
    elec           :: ElecArrays
end

# model[id] → FakeSoma
Base.getindex(m::FakeModel, id::Int) = m._somas[id]

# ── Load electrical.jl (uses the types above) ────────────────────────────────
include("src/electrical.jl")

# ── Build synthetic network ──────────────────────────────────────────────────

function make_test_model(N::Int, S::Int; seed=42)
    rng = MersenneTwister(seed)
    neurons      = OrderedDict{String,NeuronRecord}()
    soma_ids     = Dict{String,Int}()
    somas_dict   = Dict{Int,FakeSoma}()
    neuron_elec  = Dict{String,NeuronElecState}()
    synapses     = Dict{Int,SynapseRecord}()

    for i in 1:N
        nid = "n$i"
        pos = SVector{3,Float64}(rand(rng, 3)...)
        bcm = bcm_params("generic")
        nr  = NeuronRecord(
            nid, pos, "generic",
            String[], String[], String[],       # releases, attracts, repels
            NeuriteSpec[],                       # neurites
            0.02,                                # branch_prob
            2.0,                                 # L_target
            0.010,                               # soma_radius_base
            0,                                   # start_time
            false,                               # is_input
            InputSpec(),                         # input_spec
            bcm.theta_ltd, bcm.theta_ltp, bcm.k_stab,
            PRUNE_DELAY_DEFAULT,                 # prune_delay
            nothing                              # axon_dir
        )
        neurons[nid] = nr
        agent_id = i + 10000   # fake agent id
        soma_ids[nid] = agent_id
        somas_dict[agent_id] = FakeSoma(false)
        neuron_elec[nid] = NeuronElecState()
    end

    # Random synapses
    nids = collect(keys(neurons))
    for s in 1:S
        pre  = nids[rand(rng, 1:N)]
        post = nids[rand(rng, 1:N)]
        while post == pre
            post = nids[rand(rng, 1:N)]
        end
        dist = rand(rng) * 0.5
        syn  = SynapseRecord(s, pre, post, 0, 0, false, dist)
        synapses[s] = syn
    end

    ea = ElecArrays()

    model = FakeModel(neurons, soma_ids, somas_dict, neuron_elec, synapses, rng, ea)
    return model
end

# ── Full-step helper (module-level so @benchmark can capture it) ──────────

function _full_step!(ea, model, neuron_elec, synapses, rng)
    if needs_rebuild(ea, neuron_elec, synapses)
        build_elec_arrays!(ea, model, neuron_elec, synapses)
    else
        sync_to_arrays!(ea, neuron_elec, synapses)
    end
    for e in 1:N_STRUCT
        electrical_step_vec!(ea, rng, e)
    end
    sync_from_arrays!(ea, neuron_elec, synapses)
end

# ── Run benchmarks ───────────────────────────────────────────────────────────

function run_benchmarks(N, S)
    println("═══════════════════════════════════════════════════════")
    println("  Benchmark: N=$N neurons, S=$S synapses")
    println("═══════════════════════════════════════════════════════")

    model = make_test_model(N, S)
    ea = model.elec
    neuron_elec = model.neuron_elec
    synapses = model.synapses
    rng = model.rng

    # ── 1. Full rebuild ──────────────────────────────────────────────────────
    println("\n▶ Full rebuild (build_elec_arrays!):")
    build_elec_arrays!(ea, model, neuron_elec, synapses)  # warmup
    b1 = @benchmark build_elec_arrays!($ea, $model, $neuron_elec, $synapses) samples=100
    display(b1)
    println()

    # ── 2. needs_rebuild (should be false after build) ───────────────────────
    println("\n▶ needs_rebuild (should return false):")
    @assert !needs_rebuild(ea, neuron_elec, synapses) "needs_rebuild should be false!"
    b2 = @benchmark needs_rebuild($ea, $neuron_elec, $synapses) samples=200
    display(b2)
    println()

    # ── 3. sync_to_arrays! (fast path) ───────────────────────────────────────
    println("\n▶ sync_to_arrays! (fast sync, no topology change):")
    b3 = @benchmark sync_to_arrays!($ea, $neuron_elec, $synapses) samples=200
    display(b3)
    println()

    # ── 4. sync_from_arrays! (writeback) ─────────────────────────────────────
    println("\n▶ sync_from_arrays! (writeback):")
    b4 = @benchmark sync_from_arrays!($ea, $neuron_elec, $synapses) samples=200
    display(b4)
    println()

    # ── 5. Single electrical_step_vec! (100-substep inner loop unit) ─────────
    println("\n▶ Single electrical_step_vec!:")
    b5 = @benchmark electrical_step_vec!($ea, $rng, 1) samples=200
    display(b5)
    println()

    # ── 6. Full 100-substep loop (sync + 100 steps + writeback) ──────────────
    println("\n▶ Full structural step (sync + 100 substeps + writeback):")
    _full_step!(ea, model, neuron_elec, synapses, rng)  # warmup
    b6 = @benchmark _full_step!($ea, $model, $neuron_elec, $synapses, $rng) samples=50
    display(b6)
    println()

    # ── Summary ──────────────────────────────────────────────────────────────
    println("\n─── Summary ───")
    println("  Full rebuild:        $(round(median(b1).time/1e6, digits=3)) ms  ($(median(b1).allocs) allocs)")
    println("  needs_rebuild:       $(round(median(b2).time/1e3, digits=1)) µs  ($(median(b2).allocs) allocs)")
    println("  sync_to_arrays!:     $(round(median(b3).time/1e3, digits=1)) µs  ($(median(b3).allocs) allocs)")
    println("  sync_from_arrays!:   $(round(median(b4).time/1e3, digits=1)) µs  ($(median(b4).allocs) allocs)")
    println("  1x step_vec:         $(round(median(b5).time/1e3, digits=1)) µs  ($(median(b5).allocs) allocs)")
    println("  Full struct step:    $(round(median(b6).time/1e6, digits=3)) ms  ($(median(b6).allocs) allocs)")
    println("═══════════════════════════════════════════════════════\n")
end

# ── Entry point ──────────────────────────────────────────────────────────────
N = length(ARGS) >= 1 ? parse(Int, ARGS[1]) : 200
S = length(ARGS) >= 2 ? parse(Int, ARGS[2]) : 2000

run_benchmarks(N, S)
