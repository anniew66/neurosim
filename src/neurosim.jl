# =============================================================================
# neurosim.jl
#
# Usage:
#   julia --project=. src/neurosim.jl [options]
#
# Agent positions are supplied as --gc and --target flags.
# Each flag takes "x,y,z" and can be repeated for multiple agents.
#
# Examples:
#   # one growth cone, one target (defaults if no flags given)
#   julia --project=. src/neurosim.jl --gc 10,59,10 --target 100,60,100
#
#   # three growth cones, two targets
#   julia --project=. src/neurosim.jl \
#       --gc 10,59,10 --gc 20,59,20 --gc 5,59,5 \
#       --target 100,60,100 --target 80,60,90
#
# Simulation parameters (all optional, shown with defaults):
#   --seed 1
#   --extent 120.0            (cubic box 0..extent in each axis)
#   --step-size 1.5
#   --sigma 60.0
#   --chemotaxis 3.0
#   --random-walk 0.5
#   --synapse-radius 3.0
#   --max-steps 5000
#   --run-id 1
#   --vtk-dir vtk_output
#   --viz-csv simulation_viz.csv
#   --analysis-csv simulation_analysis.csv
# =============================================================================

using Agents
using StaticArrays
using LinearAlgebra
using Random
using Graphs
using CSV
using DataFrames
using WriteVTK
using Printf

# -----------------------------
# Agent definitions
# -----------------------------
@agent struct GrowthCone(ContinuousAgent{3,Float64})
    parent_id::Int      # index into gc_positions list (1-based)
    connected_to::Int   # id of connected Target, 0 = unconnected
end

@agent struct Target(ContinuousAgent{3,Float64})
    connected_to::Int   # id of connected GrowthCone, 0 = unconnected
end

# -----------------------------
# Chemoattractant field
# -----------------------------
# Each Target emits its own chemoattractant. The total concentration and
# gradient seen by a GrowthCone is the sum over all Target sources.
function chemo_conc_and_grad(x, source_positions, sigma)
    c    = 0.0
    grad = SVector{3,Float64}(0, 0, 0)
    for src in source_positions
        d    = x - src
        r2   = dot(d, d)
        ci   = exp(-r2 / (2 * sigma^2))
        c   += ci
        grad += ci * (-(d) / sigma^2)
    end
    return c, grad
end

# -----------------------------
# Utilities
# -----------------------------
function rand_unit_vec3(rng)
    v = SVector{3,Float64}(randn(rng), randn(rng), randn(rng))
    n = norm(v)
    return n > 0 ? v / n : SVector{3,Float64}(1, 0, 0)
end

function clamp_to_box(x, lo, hi)
    return SVector{3,Float64}(
        clamp(x[1], lo[1], hi[1]),
        clamp(x[2], lo[2], hi[2]),
        clamp(x[3], lo[3], hi[3])
    )
end

# -----------------------------
# Graph bookkeeping
# -----------------------------
function ensure_vertex!(model, id)
    id_to_vertex = model.id_to_vertex
    vertex_to_id = model.vertex_to_id
    g            = model.syn_graph

    if haskey(id_to_vertex, id)
        return id_to_vertex[id]
    end

    add_vertex!(g)
    v = nv(g)
    id_to_vertex[id] = v
    push!(vertex_to_id, id)
    return v
end

function add_synapse!(model, a, b)
    g  = model.syn_graph
    va = ensure_vertex!(model, a)
    vb = ensure_vertex!(model, b)
    if !has_edge(g, va, vb)
        add_edge!(g, va, vb)
    end
end

# -----------------------------
# VTK export
# -----------------------------
function write_vtk_timestep!(model, vtk_dir)
    t       = model.t
    pvd_buf = model.pvd_buffer
    agents  = collect(allagents(model))
    n       = length(agents)

    pts = zeros(Float32, 3, n)
    for (i, a) in enumerate(agents)
        pts[1, i] = Float32(a.pos[1])
        pts[2, i] = Float32(a.pos[2])
        pts[3, i] = Float32(a.pos[3])
    end

    type_arr   = zeros(Int32,   n)
    id_arr     = zeros(Int32,   n)
    conn_arr   = zeros(Int32,   n)
    syn_arr    = zeros(Int32,   n)
    radius_arr = zeros(Float32, n)

    id_to_index = Dict{Int,Int}()
    for (i, a) in enumerate(agents)
        id_to_index[a.id] = i
        type_arr[i]   = a isa GrowthCone ? Int32(0)     : Int32(1)
        id_arr[i]     = Int32(a.id)
        conn_arr[i]   = Int32(a.connected_to)
        syn_arr[i]    = Int32(a.connected_to != 0 ? 1 : 0)
        radius_arr[i] = a isa GrowthCone ? Float32(1.5) : Float32(3.0)
    end

    edges      = collect(Graphs.edges(model.syn_graph))
    vtx_to_id  = model.vertex_to_id
    line_cells = MeshCell[]

    for e in edges
        ia = get(id_to_index, vtx_to_id[src(e)], 0)
        ib = get(id_to_index, vtx_to_id[dst(e)], 0)
        if ia != 0 && ib != 0
            push!(line_cells, MeshCell(VTKCellTypes.VTK_LINE, [ia, ib]))
        end
    end

    isempty(line_cells) &&
        push!(line_cells, MeshCell(VTKCellTypes.VTK_LINE, [1, 1]))

    fname = joinpath(vtk_dir, @sprintf("frame_%05d", t))
    vtk   = vtk_grid(fname, pts, line_cells)

    vtk["agent_type",     VTKPointData()] = type_arr
    vtk["agent_id",       VTKPointData()] = id_arr
    vtk["connected_to",   VTKPointData()] = conn_arr
    vtk["synapse_formed", VTKPointData()] = syn_arr
    vtk["radius",         VTKPointData()] = radius_arr

    saved = vtk_save(vtk)
    push!(pvd_buf, (Float64(t), saved[1]))
end

function write_pvd(pvd_buf, pvd_path, vtk_dir)
    open(pvd_path, "w") do io
        println(io, """<?xml version="1.0"?>""")
        println(io, """<VTKFile type="Collection" version="0.1" byte_order="LittleEndian">""")
        println(io, """  <Collection>""")
        for (t, fpath) in pvd_buf
            rel = relpath(fpath, dirname(pvd_path))
            println(io, """    <DataSet timestep="$t" group="" part="0" file="$rel"/>""")
        end
        println(io, """  </Collection>""")
        println(io, """</VTKFile>""")
    end
end

function write_paraview_script(pvd_path, script_path)
    pvd_abs = abspath(pvd_path)
    open(script_path, "w") do io
        print(io, """
from paraview.simple import *

pvd = OpenDataFile(r\"$pvd_abs\")
RenameSource("neurosim", pvd)
Show(pvd)

renderView = GetActiveViewOrCreate("RenderView")
renderView.Background = [0.1, 0.1, 0.1]

glyph = Glyph(Input=pvd, GlyphType="Sphere")
glyph.ScaleArray       = ["POINTS", "radius"]
glyph.ScaleFactor      = 1.0
glyph.GlyphMode        = "All Points"
glyph.GlyphType.Radius = 1.0

glyphDisp = Show(glyph, renderView)
glyphDisp.Representation = "Surface"

ColorBy(glyphDisp, ("POINTS", "agent_type"))
agentLUT = GetColorTransferFunction("agent_type")
agentLUT.RGBPoints = [
    0.0, 0.17, 0.51, 0.85,
    1.0, 0.85, 0.15, 0.15,
]
agentLUT.ColorSpace = "RGB"
glyphDisp.LookupTable = agentLUT
glyphDisp.SetScalarBarVisibility(renderView, True)

tube = Tube(Input=pvd)
tube.Radius = 0.4
tubeDisp = Show(tube, renderView)
tubeDisp.Representation = "Surface"
tubeDisp.AmbientColor   = [1.0, 0.85, 0.0]
tubeDisp.DiffuseColor   = [1.0, 0.85, 0.0]

ResetCamera()
animScene = GetAnimationScene()
animScene.UpdateAnimationUsingDataTimeSteps()
Render()
print("neurosim loaded. Press Play to animate.")
""")
    end
end

# -----------------------------
# CSV logging
# -----------------------------
function log_viz!(model)
    buf = model.viz_buffer
    t   = model.t
    for agent in allagents(model)
        pos = agent.pos
        push!(buf, (
            run_id        = model.run_id,
            agent_id      = agent.id,
            agent_type    = agent isa GrowthCone ? "GrowthCone" : "Target",
            timestep      = t,
            x             = pos[1],
            y             = pos[2],
            z             = pos[3],
            connected_to  = agent.connected_to,
            synapse_formed= agent.connected_to != 0 ? 1 : 0,
        ))
    end
end

function log_analysis!(model)
    buf   = model.analysis_buffer
    t     = model.t
    srcs  = model.target_positions
    sigma = model.sigma
    for agent in allagents(model)
        pos     = agent.pos
        c, grad = chemo_conc_and_grad(pos, srcs, sigma)
        push!(buf, (
            run_id         = model.run_id,
            agent_id       = agent.id,
            timestep       = t,
            chemo_conc     = c,
            grad_x         = grad[1],
            grad_y         = grad[2],
            grad_z         = grad[3],
            grad_magnitude = norm(grad),
            dist_to_nearest= minimum(norm(pos - s) for s in srcs),
        ))
    end
end

function flush_csv!(buffer, path)
    isempty(buffer) && return
    df = DataFrame(buffer)
    isfile(path) ? CSV.write(path, df; append=true) : CSV.write(path, df)
    empty!(buffer)
end

# -----------------------------
# Agent behavior
# -----------------------------
function growthcone_step!(agent, model)
    agent.connected_to != 0 && return

    rng       = model.rng
    lo        = model.lo
    hi        = model.hi
    step_size = model.step_size
    sigma     = model.sigma
    alpha     = model.chemotaxis_strength
    beta      = model.random_walk_strength
    r_syn     = model.synapse_radius

    # gradient is summed over all unconnected targets
    free_targets = [s for (s, a) in zip(model.target_positions, model.target_ids)
                    if haskey(model.id_to_vertex, a) ?
                       false :   # already synapted
                       true]
    # simpler: just use all target positions for the field
    _, grad = chemo_conc_and_grad(agent.pos, model.target_positions, sigma)

    dir = SVector{3,Float64}(0, 0, 0)
    norm(grad) > 1e-12 && (dir += alpha * (grad / norm(grad)))
    dir += beta * rand_unit_vec3(rng)
    dir  = norm(dir) > 1e-12 ? dir / norm(dir) : rand_unit_vec3(rng)

    new_pos = clamp_to_box(agent.pos + dir * step_size, lo, hi)
    move_agent!(agent, new_pos, model)
    push!(model.gc_trajectory, (agent.id, agent.pos))

    for other in nearby_agents(agent, model, r_syn)
        if other isa Target && other.connected_to == 0
            agent.connected_to = other.id
            other.connected_to = agent.id
            add_synapse!(model, agent.id, other.id)
            break
        end
    end
end

function agent_step!(agent, model)
    agent isa GrowthCone && growthcone_step!(agent, model)
end

function model_step!(model)
    model.t += 1
    log_viz!(model)
    log_analysis!(model)
    write_vtk_timestep!(model, model.vtk_dir)
end

# -----------------------------
# Model initialization
# -----------------------------
function init_model(gc_positions, target_positions;
                    seed=1,
                    run_id=1,
                    extent=120.0,
                    step_size=1.5,
                    sigma=60.0,
                    chemotaxis_strength=3.0,
                    random_walk_strength=0.5,
                    conc_threshold=1e-3,
                    synapse_radius=3.0,
                    max_steps=5000,
                    vtk_dir="vtk_output")

    rng = MersenneTwister(seed)
    lo  = SVector{3,Float64}(0.0, 0.0, 0.0)
    hi  = SVector{3,Float64}(extent, extent, extent)

    space = ContinuousSpace((extent, extent, extent); periodic=false)

    VizRow = NamedTuple{
        (:run_id,:agent_id,:agent_type,:timestep,:x,:y,:z,:connected_to,:synapse_formed),
        Tuple{Int,Int,String,Int,Float64,Float64,Float64,Int,Int}
    }
    AnalysisRow = NamedTuple{
        (:run_id,:agent_id,:timestep,:chemo_conc,:grad_x,:grad_y,:grad_z,:grad_magnitude,:dist_to_nearest),
        Tuple{Int,Int,Int,Float64,Float64,Float64,Float64,Float64,Float64}
    }

    mkpath(vtk_dir)

    properties = Dict(
        :rng                  => rng,
        :lo                   => lo,
        :hi                   => hi,
        :step_size            => step_size,
        :sigma                => sigma,
        :chemotaxis_strength  => chemotaxis_strength,
        :random_walk_strength => random_walk_strength,
        :conc_threshold       => conc_threshold,
        :synapse_radius       => synapse_radius,
        :max_steps            => max_steps,
        :t                    => 0,
        :run_id               => run_id,
        :target_positions     => target_positions,  # Vector of SVectors
        :target_ids           => Int[],             # filled after add_agent!
        :syn_graph            => SimpleGraph(0),
        :id_to_vertex         => Dict{Int,Int}(),
        :vertex_to_id         => Int[],
        :gc_trajectory        => Vector{Tuple{Int,SVector{3,Float64}}}(),
        :synapse_step         => -1,
        :synapse_pos          => SVector{3,Float64}(0,0,0),
        :viz_buffer           => Vector{VizRow}(),
        :analysis_buffer      => Vector{AnalysisRow}(),
        :vtk_dir              => vtk_dir,
        :pvd_buffer           => Vector{Tuple{Float64,String}}(),
        :n_synapses           => 0,
    )

    model = StandardABM(
        Union{GrowthCone,Target}, space;
        properties  = properties,
        rng         = rng,
        agent_step! = agent_step!,
        model_step! = model_step!
    )

    # add targets first so their positions are known before GrowthCones move
    for tp in target_positions
        a = add_agent!(tp, Target, model, SVector{3,Float64}(0,0,0), 0)
        push!(model.target_ids, a.id)
    end

    # add growth cones
    for (i, gp) in enumerate(gc_positions)
        add_agent!(gp, GrowthCone, model, SVector{3,Float64}(0,0,0), i, 0)
    end

    return model
end


# =============================================================================
# JSON parsing  (shared by both file mode and HTTP server mode)
# =============================================================================
using JSON3
using OrderedCollections

function parse_json_config(json_str::AbstractString)
    raw = JSON3.read(json_str)

    gc_positions     = OrderedDict{String, SVector{3,Float64}}()
    target_positions = OrderedDict{String, SVector{3,Float64}}()

    if haskey(raw, :growth_cones)
        for (k, v) in pairs(raw[:growth_cones])
            length(v) == 3 || error("GrowthCone '$k': expected [x,y,z], got $v")
            gc_positions[String(k)] = SVector{3,Float64}(Float64(v[1]), Float64(v[2]), Float64(v[3]))
        end
    end

    if haskey(raw, :targets)
        for (k, v) in pairs(raw[:targets])
            length(v) == 3 || error("Target '$k': expected [x,y,z], got $v")
            target_positions[String(k)] = SVector{3,Float64}(Float64(v[1]), Float64(v[2]), Float64(v[3]))
        end
    end

    isempty(gc_positions)     && (gc_positions["gc1"]  = SVector{3,Float64}(10, 59, 10))
    isempty(target_positions) && (target_positions["t1"] = SVector{3,Float64}(100, 60, 100))

    p  = haskey(raw, :params) ? raw[:params] : JSON3.read("{}")
    gp(k, d) = haskey(p, k) ? p[k] : d

    seed           = Int(gp(:seed,           1))
    extent         = Float64(gp(:extent,         120.0))
    step_size      = Float64(gp(:step_size,      1.5))
    sigma          = Float64(gp(:sigma,          60.0))
    chemotaxis     = Float64(gp(:chemotaxis,     3.0))
    random_walk    = Float64(gp(:random_walk,    0.5))
    synapse_radius = Float64(gp(:synapse_radius, 3.0))
    max_steps      = Int(gp(:max_steps,      5000))
    run_id         = Int(gp(:run_id,         1))
    vtk_dir        = String(gp(:vtk_dir,        "vtk_output"))
    viz_csv        = String(gp(:viz_csv,        "simulation_viz.csv"))
    analysis_csv   = String(gp(:analysis_csv,   "simulation_analysis.csv"))

    return (gc_positions, target_positions,
            seed, extent, step_size, sigma, chemotaxis, random_walk,
            synapse_radius, max_steps, run_id, vtk_dir, viz_csv, analysis_csv)
end

# =============================================================================
# Simulation runner  (used by both modes)
# =============================================================================
function run_simulation(json_str::AbstractString)
    (gc_pos, tgt_pos,
     seed, extent, step_size, sigma, chemotaxis, random_walk,
     synapse_radius, max_steps, run_id, vtk_dir, viz_csv, analysis_csv) = parse_json_config(json_str)

    model = init_model(collect(values(gc_pos)), collect(values(tgt_pos));
        seed=seed, run_id=run_id, extent=extent,
        step_size=step_size, sigma=sigma,
        chemotaxis_strength=chemotaxis, random_walk_strength=random_walk,
        synapse_radius=synapse_radius, max_steps=max_steps,
        vtk_dir=vtk_dir)

    n_gc  = length(gc_pos)
    n_tgt = length(tgt_pos)
    n_synapses_needed = min(n_gc, n_tgt)

    println("Run $run_id — $n_gc GrowthCone(s), $n_tgt Target(s)")
    for (label, pos) in gc_pos;  println("  GrowthCone [$label] : $pos"); end
    for (label, pos) in tgt_pos; println("  Target     [$label] : $pos"); end
    println()

    for step in 1:max_steps
        step!(model, 1)
        n_connected = count(a.connected_to != 0
                            for a in allagents(model) if a isa GrowthCone)
        if n_connected > model.n_synapses
            model.n_synapses = n_connected
            gc = first(a for a in allagents(model) if a isa GrowthCone && a.connected_to != 0)
            println("Synapse $n_connected/$n_synapses_needed at step $step — GC($(gc.id))->T($(gc.connected_to))")
            model.synapse_step == -1 && (model.synapse_step = step; model.synapse_pos = gc.pos)
        end
        n_connected >= n_synapses_needed && (println("All synapses formed."); break)
    end

    model.n_synapses < n_synapses_needed &&
        println("Ended: $(model.n_synapses)/$n_synapses_needed synapses formed.")

    flush_csv!(model.viz_buffer,      viz_csv)
    flush_csv!(model.analysis_buffer, analysis_csv)

    pvd_path    = joinpath(vtk_dir, "simulation.pvd")
    script_path = joinpath(vtk_dir, "load_in_paraview.py")
    write_pvd(model.pvd_buffer, pvd_path, vtk_dir)
    write_paraview_script(pvd_path, script_path)

    # Return a summary dict that the HTTP handler serialises back to the caller
    return Dict(
        "status"          => "ok",
        "run_id"          => run_id,
        "n_growth_cones"  => n_gc,
        "n_targets"       => n_tgt,
        "synapses_formed" => model.n_synapses,
        "synapse_step"    => model.synapse_step,
        "synapse_pos"     => model.synapse_step != -1 ?
                                [model.synapse_pos[1], model.synapse_pos[2], model.synapse_pos[3]] :
                                nothing,
        "vtk_dir"         => abspath(vtk_dir),
        "pvd_path"        => abspath(pvd_path),
        "viz_csv"         => abspath(viz_csv),
        "analysis_csv"    => abspath(analysis_csv),
    )
end

# =============================================================================
# HTTP server mode
# =============================================================================
# POST /simulate   — body is the JSON config, returns JSON summary
# GET  /health     — returns {"status":"ok"}
#
# Runs indefinitely; Ctrl-C to stop.

using HTTP

function start_server(; host="0.0.0.0", port=8080)
    println("neurosim HTTP server listening on http://$host:$port")
    println("  POST /simulate   { \"growth_cones\": {...}, \"targets\": {...}, \"params\": {...} }")
    println("  GET  /health")
    println()

    HTTP.serve(host, port) do req::HTTP.Request
        try
            if req.method == "GET" && req.target == "/health"
                return HTTP.Response(200,
                    ["Content-Type" => "application/json"],
                    JSON3.write(Dict("status" => "ok")))
            end

            if req.method == "POST" && req.target == "/simulate"
                body = String(req.body)
                isempty(body) && return HTTP.Response(400,
                    ["Content-Type" => "application/json"],
                    JSON3.write(Dict("error" => "empty request body")))

                println("Received simulation request ($(length(body)) bytes)")
                result = run_simulation(body)

                return HTTP.Response(200,
                    ["Content-Type" => "application/json"],
                    JSON3.write(result))
            end

            return HTTP.Response(404,
                ["Content-Type" => "application/json"],
                JSON3.write(Dict("error" => "not found")))

        catch e
            msg = sprint(showerror, e)
            @warn "Request error: $msg"
            return HTTP.Response(500,
                ["Content-Type" => "application/json"],
                JSON3.write(Dict("error" => msg)))
        end
    end
end

# =============================================================================
# Entry point
# =============================================================================
#
# Modes (determined by first CLI argument):
#
#   julia --project=. src/neurosim.jl serve [port]   → start HTTP server
#   julia --project=. src/neurosim.jl config.json    → run once from file
#   julia --project=. src/neurosim.jl                → run once from default config.json

function main(args)
    # ── server mode ──────────────────────────────────────────────────────────
    if length(args) >= 1 && args[1] == "serve"
        port = length(args) >= 2 ? parse(Int, args[2]) : 8080
        start_server(; port=port)
        return
    end

    # ── file mode ─────────────────────────────────────────────────────────────
    config_path = length(args) >= 1 ? args[1] : "config.json"

    if !isfile(config_path)
        starter = """{
  "growth_cones": {
    "gc1": [10, 59, 10]
  },
  "targets": {
    "t1": [100, 60, 100]
  },
  "params": {
    "seed": 1,
    "extent": 120.0,
    "step_size": 1.5,
    "sigma": 60.0,
    "chemotaxis": 3.0,
    "random_walk": 0.5,
    "synapse_radius": 3.0,
    "max_steps": 5000,
    "run_id": 1,
    "vtk_dir": "vtk_output",
    "viz_csv": "simulation_viz.csv",
    "analysis_csv": "simulation_analysis.csv"
  }
}
"""
        write(config_path, starter)
        println("No config found — created starter at: $config_path")
        println("Edit it and re-run.")
        exit(0)
    end

    result = run_simulation(read(config_path, String))

    println("\nOutput files:")
    println("  Visualization CSV → ", result["viz_csv"])
    println("  Analysis CSV      → ", result["analysis_csv"])
    println("  VTK frames        → ", result["vtk_dir"])
    println("  ParaView PVD      → ", result["pvd_path"])
    println()
    println("ParaView: Tools > Python Shell > Run Script > load_in_paraview.py")
end

main(ARGS)