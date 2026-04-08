# neurosim.jl  —  NeuroSim main entry point
#
# Modules loaded in order:
#   src/bio_constants.jl   — constants, morphology defaults, time constants
#   src/structs.jl         — agent and data type definitions
#   src/config_parser.jl   — JSON → NeuronRecord[], ChemSource[], params
#   src/electrical.jl      — integrate-and-fire, BCM plasticity
#   src/structural.jl      — growth, retraction, branching, pruning, health
#   src/vtk_output.jl      — VTK frame writing and PVD assembly
#   src/weight_export.jl   — synapse CSV and PyTorch script generation
#
# Usage:
#   julia --project=. neurosim.jl [config.json]
#   julia --project=. neurosim.jl serve [port]

using Agents, StaticArrays, LinearAlgebra, Random, Graphs
using CSV, DataFrames, WriteVTK, Printf, JSON3, OrderedCollections, HTTP

# ── Load modules in dependency order ─────────────────────────────────────────
include("bio_constants.jl")
include("structs.jl")
include("config_parser.jl")
include("electrical.jl")
include("structural.jl")
include("vtk_output.jl")
include("weight_export.jl")

# ── Chemical field type (shared across modules) ───────────────────────────────
struct ChemSource
    name     :: String
    pos      :: SVector{3,Float64}
    sigma    :: Float64
    strength :: Float64
end

# ── Model initialisation ──────────────────────────────────────────────────────

function init_model(neurons::OrderedDict{String,NeuronRecord},
                    base_chem_sources::Vector{ChemSource},
                    tissue_density,
                    p)

    rng = MersenneTwister(p.seed)
    lo  = SVector{3,Float64}(0,0,0)
    hi  = SVector{3,Float64}(p.extent, p.extent, p.extent)

    mkpath(p.vtk_dir)

    # ── Coordinate normalisation ──────────────────────────────────────────────
    all_pos  = [nr.soma_pos for nr in values(neurons)]
    isempty(all_pos) && error("No neurons to simulate.")
    data_min = SVector{3,Float64}(minimum(v[i] for v in all_pos) for i in 1:3)
    data_max = SVector{3,Float64}(maximum(v[i] for v in all_pos) for i in 1:3)
    margin   = p.extent * 0.05
    box_span = hi .- lo .- 2*margin
    data_span= data_max .- data_min
    scale    = min(1.0, minimum(box_span[i] / max(data_span[i], 1e-6) for i in 1:3))
    offset   = lo .+ margin .- data_min .* scale

    world(pos::SVector{3,Float64}) =
        clamp_to_box(pos .* scale .+ offset, lo .+ margin, hi .- margin)

    any(data_min[i] < lo[i] || data_max[i] > hi[i] for i in 1:3) &&
        println("  Translating positions into box (scale=$(round(scale,digits=4)))")

    # Translate chem sources by same transform
    chem_sources = [ChemSource(s.name, world(s.pos), s.sigma * scale, s.strength)
                    for s in base_chem_sources]

    # Per-neuron base secretion sources (will be updated dynamically)
    for (_, nr) in neurons
        isempty(nr.releases) && continue
        for chem in nr.releases
            nr.is_input && !nr.input_spec.emit_chems && continue
            push!(chem_sources, ChemSource(chem, world(nr.soma_pos), CHEM_SIGMA_BASE, 1.0))
        end
    end

    # ── Build model ───────────────────────────────────────────────────────────
    space = ContinuousSpace((p.extent, p.extent, p.extent); periodic=false)

    properties = Dict{Symbol,Any}(
        :rng                  => rng,
        :lo                   => lo, :hi => hi,
        :step_size            => p.step_size,
        :chemotaxis_strength  => p.chemotaxis,
        :random_walk_strength => p.random_walk,
        :synapse_radius       => p.synapse_radius,
        :max_steps            => p.max_steps,
        :t                    => 0,             # structural step counter
        :t_elec               => 0,             # electrical step counter
        :run_id               => p.run_id,
        :n_struct             => p.n_struct,
        :neurons              => neurons,
        :base_chem_sources    => base_chem_sources,
        :chem_sources         => chem_sources,
        :tissue_density       => tissue_density !== nothing ? tissue_density :
                                  TissueDensityGrid(4,4,4, SVector{3,Float64}(0,0,0), p.extent/4),
        :neuron_elec          => Dict{String,NeuronElecState}(),
        :synapses             => Dict{Int,SynapseRecord}(),
        :pre_synapses         => Dict{String,Vector{Int}}(),
        :post_synapses        => Dict{String,Vector{Int}}(),
        :soma_agent_ids       => Dict{String,Int}(),
        :next_synapse_id      => 1,
        :next_branch_id       => 1,
        :syn_graph            => SimpleGraph(0),
        :id_to_vertex         => Dict{Int,Int}(),
        :vertex_to_id         => Int[],
        :n_synapses_total     => 0,
        :health_decay_rate    => p.health_decay_rate,
        :death_threshold      => p.death_threshold,
        :synapse_health_boost => p.synapse_health_boost,
        :prune_delay          => p.prune_delay,
        :vtk_dir              => p.vtk_dir,
        :pvd_buffer           => Vector{Tuple{Float64,String}}(),
        :traj_written_lens    => Dict{Tuple{String,Int},Int}(),
        :stream_traj_lens     => Dict{Tuple{String,Int},Int}(),
        :health_checkpoints  => Dict{Int,Dict{String,Float64}}(),
        :dead_neurons        => OrderedDict{String,NeuronRecord}(),
        :dead_neuron_deaths  => Dict{String,Int}(),
        :elec                => ElecArrays(),
        :dyn_chem_buffer     => ChemSource[],
        :stream_channel       => nothing,   # set to a Channel when streaming
    )

    model = StandardABM(Union{GrowthCone,Soma}, space;
                        properties, rng,
                        agent_step! = (a, m) -> nothing,
                        model_step! = (m)    -> nothing)

    # ── Spawn agents ──────────────────────────────────────────────────────────
    for (uid, nr) in neurons
        soma_w    = world(nr.soma_pos)
        defs      = morphology_defaults(nr.morphology)
        noise_r   = defs.soma_radius_noise
        soma_r    = nr.soma_radius_base * (1.0 + (rand(rng)*2-1)*noise_r/nr.soma_radius_base)
        dormant   = nr.start_time > 0

        soma_agent = add_agent!(soma_w, Soma, model,
                                SVector{3,Float64}(0,0,0),
                                uid, nr.morphology,
                                1.0,       # health
                                soma_r,    # soma_radius
                                0,         # n_stable_syn
                                dormant)
        model.soma_agent_ids[uid] = soma_agent.id

        dormant || (model.neuron_elec[uid] = NeuronElecState())

        for (ni, ns) in enumerate(nr.neurites)
            init_dir = azimuth_elevation_to_unit(ns.azimuth_deg, ns.elevation_deg)
            gc_pos   = clamp_to_box(soma_w + init_dir * p.step_size,
                                    lo .+ margin, hi .- margin)
            add_agent!(gc_pos, GrowthCone, model,
                       init_dir, uid, ni, 0,
                       ns.is_axon, 0, 0.0, false,
                       copy(nr.attracts), copy(nr.repels))
        end
    end

    return model
end

# ── Simulation loop ───────────────────────────────────────────────────────────

# Global reference so /state can read the live model between requests
_current_model = nothing

function run_simulation(json_str::AbstractString)
    neurons, base_chems, tissue_density, p = parse_json_config(json_str)

    model = init_model(neurons, base_chems, tissue_density, p)
    global _current_model; _current_model = model

    n_neurons = length(neurons)
    println("Run $(p.run_id) — $n_neurons neuron(s)")
    for (uid, nr) in neurons
        flag = nr.is_input ? " [INPUT]" : ""
        wake = nr.start_time > 0 ? " start=$(nr.start_time)" : ""
        println("  $(uid[1:8])… $(nr.morphology)$(flag)$(wake) " *
                "$(length(nr.neurites)) neurites")
    end
    println()

    last_syn_count = 0
    stability_streak = 0
    STAB_WINDOW = 50   # structural steps without synapse change = stable

    for t_struct in 1:p.max_steps
        model.t = t_struct

        # Run N_STRUCT electrical substeps
        electrical_substeps!(model, t_struct)

        # Run structural step
        n_active, n_somas = structural_step!(model, t_struct)

        # Write VTK at structural step (throttled)
        if t_struct % VTK_INTERVAL == 0 || t_struct == 1
            write_vtk_timestep!(model, p.vtk_dir)
        end

        # Push live state to any connected browser viewer (throttled)
        if model.stream_channel !== nothing && t_struct % STREAM_INTERVAL == 0
            try
                state = build_stream_state(model)
                put!(model.stream_channel, state)
            catch
                model.stream_channel = nothing
            end
        end

        # Checkpoint health every 100 steps for time-scrubbing in the viewer
        if t_struct == 1 || t_struct % 100 == 0
            snap = Dict{String,Float64}()
            for (nid, sid) in model.soma_agent_ids
                hasid(model, sid) || continue
                snap[nid] = model[sid].health
            end
            model.health_checkpoints[t_struct] = snap
        end

        # Progress print every 100 structural steps
        if t_struct % 100 == 0
            n_syn = length(model.synapses)
            println("  t=$(t_struct)  somas=$(n_somas)  gc=$(n_active)  synapses=$(n_syn)")
        end

        # Stability check
        n_syn = length(model.synapses)
        if n_syn == last_syn_count
            stability_streak += 1
        else
            stability_streak  = 0
            last_syn_count    = n_syn
        end

        # Stop if no active growth cones AND circuit is stable
        if n_active == 0 && stability_streak >= STAB_WINDOW
            println("  Circuit stable at t=$(t_struct). Stopping.")
            break
        end
    end

    # ── Outputs ───────────────────────────────────────────────────────────────
    pvd_path    = joinpath(p.vtk_dir, "simulation.pvd")
    script_path = joinpath(p.vtk_dir, "load_in_paraview.py")
    write_pvd(model.pvd_buffer, pvd_path, p.vtk_dir)
    write_paraview_script(pvd_path, script_path)

    syn_csv_path   = p.synapse_csv
    pytorch_script = replace(syn_csv_path, ".csv" => "_export_weights.py")
    export_synapse_csv(model, syn_csv_path)
    write_pytorch_script(syn_csv_path, pytorch_script)

    return Dict(
        "status"          => "ok",
        "run_id"          => p.run_id,
        "n_neurons"       => n_neurons,
        "n_synapses"      => length(model.synapses),
        "vtk_dir"         => abspath(p.vtk_dir),
        "pvd_path"        => abspath(pvd_path),
        "synapse_csv"     => abspath(syn_csv_path),
        "pytorch_script"  => abspath(pytorch_script),
    )
end

# ── Live state for browser streaming ─────────────────────────────────────────
# Produces a compact JSON-serialisable Dict of the current simulation state.
# Sent via SSE to the in-browser viewer every structural step.

function build_stream_state(model)
    somas = []
    cones = []
    for a in allagents(model)
        if a isa Soma
            elec = get(model.neuron_elec, a.neuron_id, nothing)
            fr   = elec !== nothing ? elec.fire_rate : 0.0
            push!(somas, Dict(
                "id"     => a.id,
                "nid"    => a.neuron_id[1:8],
                "pos"    => [a.pos[1], a.pos[2], a.pos[3]],
                "r"      => a.soma_radius,
                "h"      => a.health,
                "d"      => a.dormant,
                "firing" => round(fr, digits=4),
            ))
        elseif a isa GrowthCone && !a.retracted
            push!(cones, Dict(
                "id"   => a.id,
                "nid"  => a.neuron_id[1:8],
                "pos"  => [a.pos[1], a.pos[2], a.pos[3]],
                "axon" => a.is_axon,
            ))
        end
    end

    # Append dead somas so the viewer can show them when scrubbing back in time
    for (nid, nr) in model.dead_neurons
        t_death = get(model.dead_neuron_deaths, nid, 0)
        push!(somas, Dict(
            "nid"     => nid[1:8],
            "pos"     => [nr.soma_pos[1], nr.soma_pos[2], nr.soma_pos[3]],
            "r"       => nr.soma_radius_base,
            "h"       => 0.0,
            "d"       => false,
            "firing"  => 0.0,
            "dead"    => true,
            "death_t" => t_death,
        ))
    end

    # /state is intentionally minimal — just positions for live display.
    # Full trajectory history is served by /trajectories (loaded once on connect).
    # Keeping this small prevents ECANCELED errors from slow JSON serialisation.
    syn_count = length(model.synapses)

    Dict("t"      => model.t,
         "somas"  => somas,
         "cones"  => cones,
         "syns"   => syn_count,
         "extent" => model.hi[1])
end

# ── HTTP server ───────────────────────────────────────────────────────────────

function start_server(; host="0.0.0.0", port=8080)
    println("NeuroSim server on http://$host:$port")
    HTTP.serve(host, port) do req::HTTP.Request
        try
            if req.method == "GET" && req.target == "/health"
                return HTTP.Response(200, ["Content-Type"=>"application/json"],
                                     JSON3.write(Dict("status"=>"ok")))
            end
            if req.method == "POST" && req.target == "/simulate"
                body = String(req.body)
                isempty(body) && return HTTP.Response(400,
                    ["Content-Type"=>"application/json"],
                    JSON3.write(Dict("error"=>"empty request body")))
                println("Simulation request ($(length(body)) bytes)")
                result = run_simulation(body)
                return HTTP.Response(200, ["Content-Type"=>"application/json"],
                                     JSON3.write(result))
            end
            # /trajectories: full trajectory dump with timestamps — for post-run playback
            if req.method == "GET" && startswith(req.target, "/trajectories")
                global _current_model
                if _current_model === nothing
                    return HTTP.Response(404,
                        ["Content-Type"=>"application/json","Access-Control-Allow-Origin"=>"*"],
                        JSON3.write(Dict("error"=>"no simulation")))
                end
                all_segs = []
                all_neurons = merge(_current_model.neurons, _current_model.dead_neurons)
                for (uid, nr) in all_neurons
                    for (ni, ns) in enumerate(nr.neurites)
                        traj = ns.trajectory
                        length(traj) < 2 && continue
                        ax = ns.is_axon ? 1 : 0
                        for wi in 1:(length(traj)-1)
                            t_step, p1 = traj[wi]
                            _,      p2 = traj[wi+1]
                            push!(all_segs, [p1[1],p1[2],p1[3],
                                             p2[1],p2[2],p2[3],
                                             ax, Float64(t_step)])
                        end
                    end
                end
                # Build health checkpoints compact format: [[t, nid, health], ...]
                hc = _current_model.health_checkpoints
                chk_list = []
                for (t_chk, snap) in sort(collect(hc), by=x->x[1])
                    for (nid, h) in snap
                        push!(chk_list, [t_chk, nid[1:8], round(h, digits=3)])
                    end
                end
                return HTTP.Response(200,
                    ["Content-Type"=>"application/json","Access-Control-Allow-Origin"=>"*"],
                    JSON3.write(Dict(
                        "segs"     => all_segs,
                        "max_t"    => _current_model.t,
                        "extent"   => _current_model.hi[1],
                        "checkpoints" => chk_list,
                    )))
            end

            # /snapshot?t=N: soma state at checkpoint nearest to t
            if req.method == "GET" && startswith(req.target, "/snapshot")
                global _current_model
                if _current_model === nothing
                    return HTTP.Response(404,
                        ["Content-Type"=>"application/json","Access-Control-Allow-Origin"=>"*"],
                        JSON3.write(Dict("error"=>"no simulation")))
                end
                t_req = 0
                try
                    m = match(r"[?&]t=([0-9]+)", req.target)
                    if m !== nothing; t_req = parse(Int, m[1]); end
                catch; end
                # Find nearest checkpoint
                hc   = _current_model.health_checkpoints
                t_chk = isempty(hc) ? 0 : argmin(abs(k - t_req) for k in keys(hc))
                snap  = get(hc, t_chk, Dict{String,Float64}())
                somas_snap = []
                for a in allagents(_current_model)
                    a isa Soma || continue
                    h = get(snap, a.neuron_id, a.health)
                    elec = get(_current_model.neuron_elec, a.neuron_id, nothing)
                    fr   = elec !== nothing ? elec.fire_rate : 0.0
                    push!(somas_snap, Dict(
                        "nid"     => a.neuron_id[1:8],
                        "pos"     => [a.pos[1], a.pos[2], a.pos[3]],
                        "r"       => a.soma_radius,
                        "h"       => h,
                        "d"       => a.dormant,
                        "firing"  => round(fr, digits=4),
                    ))
                end
                return HTTP.Response(200,
                    ["Content-Type"=>"application/json","Access-Control-Allow-Origin"=>"*"],
                    JSON3.write(Dict("t"=>t_chk, "somas"=>somas_snap)))
            end

            # CORS preflight
            if req.method == "OPTIONS"
                return HTTP.Response(200, [
                    "Access-Control-Allow-Origin"  => "*",
                    "Access-Control-Allow-Methods" => "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers" => "Content-Type"])
            end

            # /state: snapshot of current model
            if req.method == "GET" && req.target == "/state"
                global _current_model
                if _current_model === nothing
                    return HTTP.Response(404,
                        ["Content-Type"=>"application/json",
                         "Access-Control-Allow-Origin"=>"*"],
                        JSON3.write(Dict("error"=>"no simulation running")))
                end
                state = build_stream_state(_current_model)
                body  = JSON3.write(state)
                return HTTP.Response(200,
                    ["Content-Type"              => "application/json",
                     "Access-Control-Allow-Origin" => "*",
                     "Content-Length"             => string(sizeof(body))],
                    body)
            end

            return HTTP.Response(404, ["Content-Type"=>"application/json"],
                                 JSON3.write(Dict("error"=>"not found")))
        catch e
            # Suppress ECANCELED: client closed connection before we finished writing.
            # This is normal when the browser polls faster than Julia can respond.
            msg = sprint(showerror, e)
            if occursin("ECANCELED", msg) || occursin("operation canceled", msg)
                return  # nothing to do — connection already gone
            end
            @warn "Request error: $msg"
            return HTTP.Response(500, ["Content-Type"=>"application/json"],
                                 JSON3.write(Dict("error"=>msg)))
        end
    end
end

# ── Entry point ───────────────────────────────────────────────────────────────

function main(args)
    if length(args) >= 1 && args[1] == "serve"
        port = length(args) >= 2 ? parse(Int, args[2]) : 8080
        start_server(; port)
        return
    end

    config_path = length(args) >= 1 ? args[1] : "config.json"

    if !isfile(config_path)
        starter = """{
  "neurons": {
    "input-001": {
      "soma": [0.15, 0.5, 0.5],
      "morphology": "generic",
      "is_input": true,
      "input": { "mode": "rate", "rate": 0.1, "emit_chemicals": false },
      "start_time": 0
    },
    "neuron-001": {
      "soma": [0.5, 0.5, 0.5],
      "morphology": "granule",
      "start_time": 0
    },
    "neuron-002": {
      "soma": [0.8, 0.5, 0.5],
      "morphology": "purkinje",
      "start_time": 50
    }
  },
  "global_chemicals": {
    "BDNF": { "source": [0.8, 0.5, 0.5], "sigma": 0.2, "strength": 1.0 }
  },
  "params": {
    "seed": 1,
    "extent": 1.0,
    "step_size": 0.003,
    "chemotaxis": 1.5,   // reduced: prevents single-attractor convergence
    "random_walk": 0.5,
    "synapse_radius": 0.003,
    "max_steps": 2000,
    "run_id": 1,
    "health_decay_rate": 0.0002,
    "death_threshold": 0.05,
    "synapse_health_boost": 0.4,
    "prune_delay": 5000,
    "n_struct": 100,
    "vtk_dir": "vtk_output",
    "viz_csv": "simulation_viz.csv",
    "analysis_csv": "simulation_analysis.csv",
    "synapse_csv": "synapses.csv"
  }
}
"""
        write(config_path, starter)
        println("Created starter config at: $config_path")
        println("Edit it and re-run.")
        exit(0)
    end

    result = run_simulation(read(config_path, String))
    println("\nOutputs:")
    println("  VTK frames      → ", result["vtk_dir"])
    println("  Synapse CSV     → ", result["synapse_csv"])
    println("  PyTorch script  → ", result["pytorch_script"])
    println("\nParaView: Tools → Python Shell → Run Script → load_in_paraview.py")
    println("Weights:  cd vtk_output && python synapses_export_weights.py")
end

main(ARGS)
