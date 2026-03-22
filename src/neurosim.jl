# =============================================================================
# neurosim.jl
#
# Biologically-grounded 3D neural growth simulation.
#
# Neurons have somas, neurites (axon + dendrites), growth cones on each
# neurite tip, and interstitial branches. Growth is driven by:
#   - Global chemoattractant/repellant fields
#   - Neuron-specific secreted chemical gradients
#   - Stochastic random walk
#
# Synapse formation occurs when an axon growth cone approaches a dendrite
# growth cone or dendrite shaft within synapse_radius, and both neurons
# express compatible receptor/ligand pairs.
#
# Usage (file mode):
#   julia --project=. src/neurosim.jl [config.json]
#
# Usage (server mode):
#   julia --project=. src/neurosim.jl serve [port]
#
# Input JSON format:
# {
#   "neurons": {
#     "<uuid>": {
#       "soma": [x, y, z],
#       "morphology": "purkinje",          -- optional, default "generic"
#       "releases": ["BDNF", "Sema3A"],    -- chemicals this neuron secretes
#       "attracts":  ["BDNF"],             -- chemicals this neuron's GCs follow
#       "repels":    ["Sema3A"],           -- chemicals this neuron's GCs flee
#       "neurites": [[azimuth_deg, elevation_deg], ...]
#     }
#   },
#   "global_chemicals": {                  -- optional spatially-uniform or
#     "BDNF": { "source": [x,y,z], "sigma": 40.0, "strength": 1.0 },
#     ...
#   },
#   "params": { ... }                      -- same global params as before
# }
#
# Compact shorthand (matching your pasted format) is also accepted:
# {
#   "neurons":  { "<uuid>": [x, y, z], ... },
#   "neurites": { "<uuid>": [[az, el], ...], ... }
# }
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
using JSON3
using OrderedCollections
using HTTP

# =============================================================================
# Constants & morphology defaults
# =============================================================================

# Per-morphology defaults. Override via per-neuron JSON fields.
const MORPHOLOGY_DEFAULTS = Dict(
    "purkinje"  => (branch_prob=0.04, max_branch_length=40.0,
                    releases=["BDNF"], attracts=["NT3"],  repels=["Sema3A"]),
    "granule"   => (branch_prob=0.01, max_branch_length=20.0,
                    releases=["NT3"],  attracts=["BDNF"], repels=[]),
    "basket"    => (branch_prob=0.02, max_branch_length=25.0,
                    releases=["GABA"], attracts=["BDNF"], repels=["Sema3A"]),
    "stellate"  => (branch_prob=0.02, max_branch_length=22.0,
                    releases=["GABA"], attracts=["BDNF"], repels=[]),
    "golgi"     => (branch_prob=0.02, max_branch_length=30.0,
                    releases=["GABA"], attracts=["NT3"],  repels=[]),
    "generic"   => (branch_prob=0.02, max_branch_length=30.0,
                    releases=[],       attracts=[],        repels=[]),
)

function morphology_defaults(morphology::String)
    get(MORPHOLOGY_DEFAULTS, lowercase(morphology), MORPHOLOGY_DEFAULTS["generic"])
end

# =============================================================================
# Chemical field helpers
# =============================================================================
# A ChemField is a named Gaussian point source. Multiple sources of the same
# chemical are summed. Over time the model will support dynamic fields; for
# now sources are fixed but the API is forward-compatible.

struct ChemSource
    name     :: String
    pos      :: SVector{3,Float64}
    sigma    :: Float64
    strength :: Float64
end

# Returns (concentration, gradient) at point x from a list of sources
# filtered to `chemical_name`.
function chem_field(x::SVector{3,Float64}, sources::Vector{ChemSource},
                    chemical_name::String)
    c    = 0.0
    grad = SVector{3,Float64}(0, 0, 0)
    for src in sources
        src.name != chemical_name && continue
        d  = x - src.pos
        r2 = dot(d, d)
        ci = src.strength * exp(-r2 / (2 * src.sigma^2))
        c   += ci
        grad += ci * (-d / src.sigma^2)   # ∇ of Gaussian
    end
    return c, grad
end

# Net steering vector for a growth cone that attracts to `attract_chems`
# and repels from `repel_chems`. Sources include both global and all
# per-neuron secretions from *other* neurons.
function net_chemical_gradient(x::SVector{3,Float64},
                                attract_chems::Vector{String},
                                repel_chems::Vector{String},
                                sources::Vector{ChemSource})
    g = SVector{3,Float64}(0, 0, 0)
    for chem in attract_chems
        _, gi = chem_field(x, sources, chem)
        g += gi
    end
    for chem in repel_chems
        _, gi = chem_field(x, sources, chem)
        g -= gi
    end
    return g
end

# =============================================================================
# Coordinate helpers
# =============================================================================

function azimuth_elevation_to_unit(az_deg::Float64, el_deg::Float64)
    az = deg2rad(az_deg)
    el = deg2rad(el_deg)
    return SVector{3,Float64}(cos(el)*cos(az), cos(el)*sin(az), sin(el))
end

function rand_unit_vec3(rng)
    v = SVector{3,Float64}(randn(rng), randn(rng), randn(rng))
    n = norm(v)
    n > 0 ? v / n : SVector{3,Float64}(1, 0, 0)
end

function clamp_to_box(x, lo, hi)
    SVector{3,Float64}(clamp(x[1],lo[1],hi[1]),
                       clamp(x[2],lo[2],hi[2]),
                       clamp(x[3],lo[3],hi[3]))
end

# =============================================================================
# Agent definitions
# =============================================================================
#
# Hierarchy:
#   Neuron (not an agent — stored in model properties)
#     └─ Neurite (not an agent — stores shaft trajectory)
#          └─ GrowthCone (ContinuousAgent) — the moving tip
#
# Synapses form between an AxonCone and a DendriteCone (or DendriteSoma).

@agent struct GrowthCone(ContinuousAgent{3,Float64})
    neuron_id    :: String   # UUID of parent neuron
    neurite_idx  :: Int      # index into neuron's neurite list (1-based)
    branch_idx   :: Int      # 0 = primary, >0 = interstitial branch id
    is_axon      :: Bool     # true → axon tip; false → dendrite tip
    connected_to :: Int      # agent id of the GrowthCone it synapses with, 0=none
    branch_len   :: Float64  # total path length travelled since branching
    stopped      :: Bool     # true when max length reached or synapse formed
    attract_chems:: Vector{String}
    repel_chems  :: Vector{String}
end

# Soma agent — represents the cell body, participates in nearby-agent queries
@agent struct Soma(ContinuousAgent{3,Float64})
    neuron_id :: String
    morphology:: String
end

# =============================================================================
# Neuron & Neurite data structures (stored in model properties, not agents)
# =============================================================================

struct NeuriteSpec
    azimuth_deg   :: Float64
    elevation_deg :: Float64
    is_axon       :: Bool
    # shaft trajectory: list of (step, position) pairs
    trajectory    :: Vector{Tuple{Int,SVector{3,Float64}}}
end

mutable struct NeuronRecord
    id            :: String
    soma_pos      :: SVector{3,Float64}
    morphology    :: String
    releases      :: Vector{String}
    attracts      :: Vector{String}
    repels        :: Vector{String}
    neurites      :: Vector{NeuriteSpec}
    branch_prob   :: Float64
    max_branch_len:: Float64
end

# =============================================================================
# Graph bookkeeping (unchanged from original)
# =============================================================================

function ensure_vertex!(model, id)
    id_to_vertex = model.id_to_vertex
    vertex_to_id = model.vertex_to_id
    g            = model.syn_graph
    haskey(id_to_vertex, id) && return id_to_vertex[id]
    add_vertex!(g)
    v = nv(g)
    id_to_vertex[id] = v
    push!(vertex_to_id, id)
    return v
end

function add_synapse!(model, a, b)
    va = ensure_vertex!(model, a)
    vb = ensure_vertex!(model, b)
    has_edge(model.syn_graph, va, vb) || add_edge!(model.syn_graph, va, vb)
end

# =============================================================================
# Interstitial branching
# =============================================================================
# Called probabilistically each step for every active primary GrowthCone.
# Spawns a new GrowthCone agent at a random point along the shaft trajectory.

function maybe_branch!(gc::GrowthCone, model)
    gc.stopped && return
    gc.branch_idx != 0 && return          # only branch from primary neurites
    rand(model.rng) > model.branch_prob  && return

    neuron = model.neurons[gc.neuron_id]
    traj   = neuron.neurites[gc.neurite_idx].trajectory
    isempty(traj) && return

    # Pick a random point along the existing shaft
    _, branch_origin = traj[rand(model.rng, 1:length(traj))]

    # Random lateral direction (perpendicular-ish to primary direction)
    branch_dir = rand_unit_vec3(model.rng)

    branch_id = model.next_branch_id
    model.next_branch_id += 1

    add_agent!(branch_origin, GrowthCone, model,
               SVector{3,Float64}(0,0,0),   # vel placeholder
               gc.neuron_id,
               gc.neurite_idx,
               branch_id,
               gc.is_axon,
               0,             # connected_to
               0.0,           # branch_len
               false,         # stopped
               copy(gc.attract_chems),
               copy(gc.repel_chems))
end

# =============================================================================
# Agent step
# =============================================================================

function growthcone_step!(gc::GrowthCone, model)
    gc.stopped && return

    rng       = model.rng
    step_size = model.step_size
    alpha     = model.chemotaxis_strength
    beta      = model.random_walk_strength
    r_syn     = model.synapse_radius
    lo, hi    = model.lo, model.hi
    max_blen  = model.neurons[gc.neuron_id].max_branch_len

    # ── Chemical steering ─────────────────────────────────────────────────
    # Sources = global sources + all per-neuron secretions except own neuron
    sources = model.chem_sources  # already excludes nothing; GC decides what to follow
    g_chem  = net_chemical_gradient(gc.pos, gc.attract_chems, gc.repel_chems, sources)

    # ── Compose direction ─────────────────────────────────────────────────
    dir = SVector{3,Float64}(0,0,0)
    norm(g_chem) > 1e-12 && (dir += alpha * (g_chem / norm(g_chem)))
    dir += beta * rand_unit_vec3(rng)
    dir  = norm(dir) > 1e-12 ? dir / norm(dir) : rand_unit_vec3(rng)

    new_pos = clamp_to_box(gc.pos + dir * step_size, lo, hi)
    move_agent!(gc, new_pos, model)

    # Record trajectory on the parent neurite shaft (primary only)
    if gc.branch_idx == 0
        push!(model.neurons[gc.neuron_id].neurites[gc.neurite_idx].trajectory,
              (model.t, gc.pos))
    end

    gc.branch_len += step_size

    # ── Max-length stop ───────────────────────────────────────────────────
    if gc.branch_len >= max_blen
        gc.stopped = true
        return
    end

    # ── Synapse check ─────────────────────────────────────────────────────
    # Axon GC looks for dendrite GCs (or somas) within synapse_radius.
    # Dendrite GC does nothing — it waits to be found.
    if gc.is_axon
        for other in nearby_agents(gc, model, r_syn)
            if other isa GrowthCone && !other.is_axon && other.connected_to == 0
                # Chemical compatibility: axon neuron must release something
                # the dendrite neuron attracts (forward-compatible hook)
                axon_neuron = model.neurons[gc.neuron_id]
                dend_neuron = model.neurons[other.neuron_id]
                compatible  = isempty(axon_neuron.releases) ||
                              isempty(dend_neuron.attracts) ||
                              !isempty(intersect(axon_neuron.releases,
                                                 dend_neuron.attracts))
                if compatible
                    gc.connected_to    = other.id
                    other.connected_to = gc.id
                    gc.stopped         = true
                    other.stopped      = true
                    add_synapse!(model, gc.id, other.id)
                    model.n_synapses  += 1
                    println("  Synapse at step $(model.t): " *
                            "axon($(gc.id)) [$(gc.neuron_id[1:8])] → " *
                            "dendrite($(other.id)) [$(other.neuron_id[1:8])]")
                    break
                end
            end
        end
    end

    # ── Interstitial branching ────────────────────────────────────────────
    maybe_branch!(gc, model)
end

function agent_step!(agent, model)
    agent isa GrowthCone && growthcone_step!(agent, model)
end

function model_step!(model)
    model.t += 1
    # Only log/write VTK on steps where at least one GrowthCone is active.
    # Prevents thousands of identical tail frames once all cones have stopped.
    any_active = any(a isa GrowthCone && !a.stopped for a in allagents(model))
    if any_active
        log_viz!(model)
        log_analysis!(model)
        write_vtk_timestep!(model, model.vtk_dir)
    end
end

# =============================================================================
# CSV logging
# =============================================================================

function log_viz!(model)
    buf = model.viz_buffer
    t   = model.t
    for agent in allagents(model)
        pos = agent.pos
        if agent isa GrowthCone
            push!(buf, (
                run_id        = model.run_id,
                agent_id      = agent.id,
                agent_type    = agent.is_axon ? "AxonCone" : "DendriteCone",
                neuron_id     = agent.neuron_id,
                neurite_idx   = agent.neurite_idx,
                branch_idx    = agent.branch_idx,
                timestep      = t,
                x             = pos[1], y = pos[2], z = pos[3],
                connected_to  = agent.connected_to,
                synapse_formed= agent.connected_to != 0 ? 1 : 0,
                branch_len    = agent.branch_len,
                stopped       = agent.stopped ? 1 : 0,
            ))
        elseif agent isa Soma
            push!(buf, (
                run_id        = model.run_id,
                agent_id      = agent.id,
                agent_type    = "Soma",
                neuron_id     = agent.neuron_id,
                neurite_idx   = -1,
                branch_idx    = -1,
                timestep      = t,
                x             = pos[1], y = pos[2], z = pos[3],
                connected_to  = 0,
                synapse_formed= 0,
                branch_len    = 0.0,
                stopped       = 1,
            ))
        end
    end
end

function log_analysis!(model)
    buf     = model.analysis_buffer
    t       = model.t
    sources = model.chem_sources
    for agent in allagents(model)
        agent isa GrowthCone || continue
        pos     = agent.pos
        # Log net attractive gradient magnitude as proxy for chemo signal
        g = net_chemical_gradient(pos, agent.attract_chems, agent.repel_chems, sources)
        push!(buf, (
            run_id          = model.run_id,
            agent_id        = agent.id,
            neuron_id       = agent.neuron_id,
            timestep        = t,
            net_grad_x      = g[1],
            net_grad_y      = g[2],
            net_grad_z      = g[3],
            net_grad_mag    = norm(g),
            branch_len      = agent.branch_len,
            is_axon         = agent.is_axon ? 1 : 0,
            connected       = agent.connected_to != 0 ? 1 : 0,
        ))
    end
end

function flush_csv!(buffer, path)
    isempty(buffer) && return
    df = DataFrame(buffer)
    isfile(path) ? CSV.write(path, df; append=true) : CSV.write(path, df)
    empty!(buffer)
end

# =============================================================================
# VTK export
# =============================================================================

function write_vtk_timestep!(model, vtk_dir)
    t        = model.t
    pvd_buf  = model.pvd_buffer
    agents   = collect(allagents(model))
    n_agents = length(agents)
    n_agents == 0 && return

    # ── Build point list ──────────────────────────────────────────────────
    # Points = all agent positions PLUS all neurite shaft trajectory points.
    # We need everything in one flat array for vtk_grid.

    # 1. Agent points (indexed 1..n_agents)
    all_pts   = Vector{SVector{3,Float32}}()
    type_arr  = Int32[]
    id_arr    = Int32[]
    conn_arr  = Int32[]
    syn_arr   = Int32[]
    radius_arr= Float32[]
    branch_arr= Int32[]

    id_to_ptidx = Dict{Int,Int}()   # agent id -> point index (1-based)

    for a in agents
        push!(all_pts, SVector{3,Float32}(a.pos[1], a.pos[2], a.pos[3]))
        id_to_ptidx[a.id] = length(all_pts)
        if a isa Soma
            push!(type_arr,   Int32(0))
            push!(id_arr,     Int32(a.id))
            push!(conn_arr,   Int32(0))
            push!(syn_arr,    Int32(0))
            push!(radius_arr, Float32(4.0))
            push!(branch_arr, Int32(0))
        else  # GrowthCone
            push!(type_arr,   a.is_axon ? Int32(1) : Int32(2))
            push!(id_arr,     Int32(a.id))
            push!(conn_arr,   Int32(a.connected_to))
            push!(syn_arr,    Int32(a.connected_to != 0 ? 1 : 0))
            push!(radius_arr, Float32(1.5))
            push!(branch_arr, Int32(a.branch_idx))
        end
    end

    # 2. Shaft trajectory points (type=3, id=0 — not selectable agents)
    #    For each neurite, collect: soma_idx -> [shaft pts] -> gc_tip_idx
    line_cells = MeshCell[]

    # Build soma lookup: neuron_id -> point index of its Soma agent
    soma_ptidx = Dict{String,Int}()
    for a in agents
        a isa Soma && (soma_ptidx[a.neuron_id] = id_to_ptidx[a.id])
    end

    # Build gc lookup: (neuron_id, neurite_idx, branch_idx) -> gc point index
    gc_ptidx = Dict{Tuple{String,Int,Int},Int}()
    for a in agents
        if a isa GrowthCone
            gc_ptidx[(a.neuron_id, a.neurite_idx, a.branch_idx)] = id_to_ptidx[a.id]
        end
    end

    for (uid, nr) in model.neurons
        s_idx = get(soma_ptidx, uid, 0)
        s_idx == 0 && continue

        for (ni, ns) in enumerate(nr.neurites)
            traj = ns.trajectory
            isempty(traj) && continue

            # Add shaft points to the point array
            shaft_indices = Int[]
            for (_, pos) in traj
                push!(all_pts, SVector{3,Float32}(pos[1], pos[2], pos[3]))
                idx = length(all_pts)
                push!(shaft_indices, idx)
                # Shaft points get type=3 (neurite shaft), no agent id
                push!(type_arr,   Int32(3))
                push!(id_arr,     Int32(0))
                push!(conn_arr,   Int32(0))
                push!(syn_arr,    Int32(0))
                push!(radius_arr, Float32(0.8))
                push!(branch_arr, Int32(0))
            end

            # Polyline: soma -> shaft points -> growth cone tip
            gc_key  = (uid, ni, 0)
            tip_idx = get(gc_ptidx, gc_key, 0)
            poly_pts = vcat([s_idx], shaft_indices,
                            tip_idx != 0 ? [tip_idx] : Int[])
            length(poly_pts) >= 2 &&
                push!(line_cells,
                      MeshCell(VTKCellTypes.VTK_POLY_LINE, poly_pts))
        end
    end

    # 3. Synapse edges (VTK_LINE between paired GrowthCone tips)
    vtx_to_id = model.vertex_to_id
    for e in Graphs.edges(model.syn_graph)
        aid_a = vtx_to_id[src(e)]
        aid_b = vtx_to_id[dst(e)]
        ia = get(id_to_ptidx, aid_a, 0)
        ib = get(id_to_ptidx, aid_b, 0)
        ia != 0 && ib != 0 &&
            push!(line_cells, MeshCell(VTKCellTypes.VTK_LINE, [ia, ib]))
    end

    # VTK requires at least one cell
    isempty(line_cells) &&
        push!(line_cells, MeshCell(VTKCellTypes.VTK_LINE, [1, 1]))

    # ── Assemble and write ─────────────────────────────────────────────────
    n_pts = length(all_pts)
    pts   = zeros(Float32, 3, n_pts)
    for (i, p) in enumerate(all_pts)
        pts[1,i] = p[1]; pts[2,i] = p[2]; pts[3,i] = p[3]
    end

    # Pad per-point arrays to cover shaft points (already correct length above)
    fname = joinpath(vtk_dir, @sprintf("frame_%05d", t))
    vtk   = vtk_grid(fname, pts, line_cells)
    vtk["agent_type",     VTKPointData()] = type_arr
    vtk["agent_id",       VTKPointData()] = id_arr
    vtk["connected_to",   VTKPointData()] = conn_arr
    vtk["synapse_formed", VTKPointData()] = syn_arr
    vtk["radius",         VTKPointData()] = radius_arr
    vtk["branch_idx",     VTKPointData()] = branch_arr
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
    lines = String[]

    push!(lines, "from paraview.simple import *")
    push!(lines, "import sys")
    push!(lines, "")
    push!(lines, "# ── Load data ────────────────────────────────────────────────────────────")
    push!(lines, "pvd = OpenDataFile(r\"" * pvd_abs * "\")")
    push!(lines, "RenameSource(\'neurosim\', pvd)")
    push!(lines, "")
    push!(lines, "renderView = GetActiveViewOrCreate(\'RenderView\')")
    push!(lines, "renderView.Background = [0.05, 0.05, 0.1]")
    push!(lines, "")
    push!(lines, "# ── Sphere glyphs: 0=soma(white) 1=axon(blue) 2=dendrite(red) 3=shaft(grey) ──")
    push!(lines, "sphereSrc = Sphere()")
    push!(lines, "sphereSrc.ThetaResolution = 14")
    push!(lines, "sphereSrc.PhiResolution   = 14")
    push!(lines, "glyph = Glyph(Input=pvd, GlyphType=sphereSrc)")
    push!(lines, "glyph.ScaleArray  = [\'POINTS\', \'radius\']")
    push!(lines, "glyph.ScaleFactor = 1.0")
    push!(lines, "glyph.GlyphMode   = \'All Points\'")
    push!(lines, "glyphDisp = Show(glyph, renderView)")
    push!(lines, "glyphDisp.Representation = \'Surface\'")
    push!(lines, "ColorBy(glyphDisp, (\'POINTS\', \'agent_type\'))")
    push!(lines, "lut = GetColorTransferFunction(\'agent_type\')")
    push!(lines, "lut.RGBPoints = [0.0,1.00,1.00,1.00, 1.0,0.17,0.51,0.85, 2.0,0.85,0.15,0.15, 3.0,0.45,0.45,0.45]")
    push!(lines, "lut.ColorSpace = \'RGB\'")
    push!(lines, "glyphDisp.LookupTable = lut")
    push!(lines, "glyphDisp.SetScalarBarVisibility(renderView, True)")
    push!(lines, "")
    push!(lines, "# ── Neurite shafts as tubes ──────────────────────────────────────────────")
    push!(lines, "# ExtractSurface converts vtkUnstructuredGrid -> vtkPolyData for Tube.")
    push!(lines, "surf = ExtractSurface(Input=pvd)")
    push!(lines, "tube = Tube(Input=surf)")
    push!(lines, "tube.Radius = 0.25")
    push!(lines, "# ParaView spells this differently across versions — try both")
    push!(lines, "try:")
    push!(lines, "    tube.NumberofSides = 8")
    push!(lines, "except AttributeError:")
    push!(lines, "    try:")
    push!(lines, "        tube.NumberOfSides = 8")
    push!(lines, "    except AttributeError:")
    push!(lines, "        pass  # older ParaView uses the filter default, that is fine")
    push!(lines, "tubeDisp = Show(tube, renderView)")
    push!(lines, "tubeDisp.Representation = \'Surface\'")
    push!(lines, "ColorBy(tubeDisp, (\'POINTS\', \'agent_type\'))")
    push!(lines, "tubeDisp.LookupTable = lut")
    push!(lines, "tubeDisp.Opacity = 0.75")
    push!(lines, "")
    push!(lines, "# ── Agent ID labels ──────────────────────────────────────────────────────")
    push!(lines, "# Threshold out shaft interpolation points (agent_id == 0) so only")
    push!(lines, "# real agents get labels. Labels are added via the spreadsheet-style")
    push!(lines, "# API which is stable across ParaView 5.x and 6.x.")
    push!(lines, "thresh = Threshold(Input=pvd)")
    push!(lines, "thresh.Scalars   = [\'POINTS\', \'agent_id\']")
    push!(lines, "thresh.LowerThreshold = 1")
    push!(lines, "thresh.UpperThreshold = 999999")
    push!(lines, "threshDisp = Show(thresh, renderView)")
    push!(lines, "threshDisp.Representation = \'Point Gaussian\'")
    push!(lines, "threshDisp.GaussianRadius = 0.001  # effectively invisible points")
    push!(lines, "threshDisp.SetScalarBarVisibility(renderView, False)")
    push!(lines, "# Enable point labels through the display properties dict")
    push!(lines, "try:")
    push!(lines, "    threshDisp.PointLabelVisibility = 1")
    push!(lines, "    threshDisp.PointLabelArrayName  = \'agent_id\'")
    push!(lines, "    threshDisp.PointLabelFontSize   = 9")
    push!(lines, "    threshDisp.PointLabelColor      = [1.0, 1.0, 0.6]")
    push!(lines, "    threshDisp.PointLabelFormat     = \'%-#6.0f\'")
    push!(lines, "except AttributeError:")
    push!(lines, "    # Labels not supported via script in this ParaView build.")
    push!(lines, "    # In the GUI: select the threshold source -> Filters -> Label.")
    push!(lines, "    print(\'Note: point labels not available via script — add manually if needed.\')")
    push!(lines, "")
    push!(lines, "# ── Camera & animation ───────────────────────────────────────────────────")
    push!(lines, "ResetCamera()")
    push!(lines, "animScene = GetAnimationScene()")
    push!(lines, "animScene.UpdateAnimationUsingDataTimeSteps()")
    push!(lines, "Render()")
    push!(lines, "print(\'\'')")
    push!(lines, "print(\'neurosim loaded:\')")
    push!(lines, "print(\'  agent_type  0=soma  1=axon tip  2=dendrite tip  3=neurite shaft\')")
    push!(lines, "print(\'  Press Play (toolbar) to animate through timesteps.\')")
    push!(lines, "print(\'  Right-click pipeline entries to toggle visibility.\')")
    push!(lines, "print(\'\'')")
    push!(lines, "Interact()")

    write(script_path, join(lines, "\n") * "\n")
end
# =============================================================================
# JSON config parsing
# =============================================================================
# Accepts two formats:
#
# FULL format — per-neuron overrides for everything:
#   { "neurons": {
#       "<uuid>": {
#         "soma":           [x, y, z],
#         "morphology":     "purkinje",     -- sets defaults; fields below override
#         "releases":       ["BDNF"],       -- optional; default from morphology
#         "attracts":       ["NT3"],        -- optional; default from morphology
#         "repels":         ["Sema3A"],     -- optional; default from morphology
#         "branch_prob":    0.03,           -- optional; default from morphology
#         "max_branch_len": 35.0,           -- optional; default from morphology
#         "neurites":       [[az, el], ...]
#       }
#     },
#     "global_chemicals": { "BDNF": {"source":[x,y,z],"sigma":40,"strength":1} },
#     "params": { ... }
#   }
#
# COMPACT format — soma positions + angles only; morphology via separate map:
#   { "neurons":      { "<uuid>": [x, y, z], ... },
#     "neurites":     { "<uuid>": [[az, el], ...], ... },
#     "morphologies": { "<uuid>": "purkinje", ... },  -- optional, default "generic"
#     "params": { ... }
#   }
#   Chemical/branching values come entirely from morphology defaults in compact
#   mode. Use full format for per-neuron chemical or branching overrides.


# Shared helper — builds a NeuronRecord from already-extracted fields.
# `angle_list` is a vector of [az, el] pairs.
# All chemical/branching fields fall back to morphology defaults when `nothing`.
function build_neuron_record(rng,
                             uid_str    :: String,
                             soma_pos   :: SVector{3,Float64},
                             morphology :: String,
                             angle_list,
                             releases,          # Vector{String} | nothing
                             attracts,          # Vector{String} | nothing
                             repels,            # Vector{String} | nothing
                             branch_prob,       # Float64 | nothing
                             max_branch_len)    # Float64 | nothing

    defs = morphology_defaults(morphology)

    releases_f      = releases       !== nothing ? releases       : collect(defs.releases)
    attracts_f      = attracts       !== nothing ? attracts       : collect(defs.attracts)
    repels_f        = repels         !== nothing ? repels         : collect(defs.repels)
    branch_prob_f   = branch_prob    !== nothing ? branch_prob    : defs.branch_prob
    max_branch_f    = max_branch_len !== nothing ? max_branch_len : defs.max_branch_length

    # Build NeuriteSpec list (is_axon=false placeholder — assigned below)
    raw_specs = NeuriteSpec[]
    for angles in angle_list
        az = Float64(angles[1])
        el = Float64(angles[2])
        push!(raw_specs, NeuriteSpec(az, el, false,
                                     Vector{Tuple{Int,SVector{3,Float64}}}()))
    end

    # Guarantee at least one neurite — empty list from client should not crash
    if isempty(raw_specs)
        push!(raw_specs, NeuriteSpec(0.0, 0.0, false,
                                     Vector{Tuple{Int,SVector{3,Float64}}}()))
    end

    # Randomly assign exactly one neurite as the axon
    axon_idx = rand(rng, 1:length(raw_specs))
    neurite_specs = [NeuriteSpec(ns.azimuth_deg, ns.elevation_deg,
                                 ni == axon_idx, ns.trajectory)
                     for (ni, ns) in enumerate(raw_specs)]

    return NeuronRecord(uid_str, soma_pos, morphology,
                        releases_f, attracts_f, repels_f,
                        neurite_specs, branch_prob_f, max_branch_f)
end

function parse_json_config(json_str::AbstractString)
    raw = JSON3.read(json_str)

    neurons      = OrderedDict{String,NeuronRecord}()
    chem_sources = ChemSource[]
    tmp_rng      = MersenneTwister(0)   # only used for axon assignment here;
                                        # model uses its own seeded rng at runtime

    # ── Detect format ──────────────────────────────────────────────────────
    # ── Guard against old gc/target format ──────────────────────────────
    if haskey(raw, :growth_cones) || haskey(raw, :gc) || !haskey(raw, :neurons)
        error("""
Old config format detected.\nDelete or rename config.json and re-run to generate a valid starter config.\n""")
    end

    # Guard against empty neurons dict
    if isempty(raw[:neurons])
        error("neurons object is empty — nothing to simulate.")
    end

    first_val  = first(values(raw[:neurons]))
    is_compact = first_val isa AbstractVector   # [x,y,z] array → compact

    if is_compact
        # ── Compact format ─────────────────────────────────────────────────
        # "neurons":  { "<uuid>": [x, y, z], ... }
        # "neurites": { "<uuid>": [[az, el], ...], ... }
        # Optional top-level "morphologies": { "<uuid>": "purkinje", ... }
        # No per-neuron chemical overrides in compact mode.
        neurites_map    = haskey(raw, :neurites)    ? raw[:neurites]    : Dict()
        morphology_map  = haskey(raw, :morphologies) ? raw[:morphologies] : Dict()

        for (uid, pos_raw) in pairs(raw[:neurons])
            uid_str    = String(uid)
            soma_pos   = SVector{3,Float64}(Float64(pos_raw[1]),
                                             Float64(pos_raw[2]),
                                             Float64(pos_raw[3]))
            morphology = haskey(morphology_map, uid) ? String(morphology_map[uid]) : "generic"
            angle_list = haskey(neurites_map, uid)   ? neurites_map[uid]           : [[0, 0]]

            neurons[uid_str] = build_neuron_record(tmp_rng, uid_str, soma_pos,
                                                    morphology, angle_list,
                                                    nothing, nothing, nothing,
                                                    nothing, nothing)
        end
    else
        # ── Full format ────────────────────────────────────────────────────
        # "neurons": { "<uuid>": { "soma":[x,y,z], "morphology":"...",
        #                          "releases":[...], "attracts":[...], "repels":[...],
        #                          "branch_prob": 0.03, "max_branch_len": 35.0,
        #                          "neurites":[[az,el],...] } }
        for (uid, ndata) in pairs(raw[:neurons])
            uid_str    = String(uid)
            pos_raw    = ndata[:soma]
            soma_pos   = SVector{3,Float64}(Float64(pos_raw[1]),
                                             Float64(pos_raw[2]),
                                             Float64(pos_raw[3]))
            morphology = haskey(ndata, :morphology)    ? String(ndata[:morphology])          : "generic"
            angle_list = haskey(ndata, :neurites)      ? ndata[:neurites]                    : [[0, 0]]
            releases   = haskey(ndata, :releases)      ? String.(ndata[:releases])           : nothing
            attracts   = haskey(ndata, :attracts)      ? String.(ndata[:attracts])           : nothing
            repels     = haskey(ndata, :repels)        ? String.(ndata[:repels])             : nothing
            bprob      = haskey(ndata, :branch_prob)   ? Float64(ndata[:branch_prob])        : nothing
            mblen      = haskey(ndata, :max_branch_len) ? Float64(ndata[:max_branch_len])     : nothing

            neurons[uid_str] = build_neuron_record(tmp_rng, uid_str, soma_pos,
                                                    morphology, angle_list,
                                                    releases, attracts, repels,
                                                    bprob, mblen)
        end
    end

    # ── Global chemical sources ────────────────────────────────────────────
    if haskey(raw, :global_chemicals)
        for (cname, cdata) in pairs(raw[:global_chemicals])
            src_pos = SVector{3,Float64}(Float64(cdata[:source][1]),
                                          Float64(cdata[:source][2]),
                                          Float64(cdata[:source][3]))
            push!(chem_sources, ChemSource(String(cname), src_pos,
                                           Float64(cdata[:sigma]),
                                           Float64(cdata[:strength])))
        end
    end

    # Per-neuron secretion sources are added in init_model after coordinate
    # translation, so they use the correct world-space soma positions.

    # ── Params ────────────────────────────────────────────────────────────
    p    = haskey(raw, :params) ? raw[:params] : JSON3.read("{}")
    gp(k, d) = haskey(p, k) ? p[k] : d

    seed           = Int(gp(:seed,           1))
    extent         = Float64(gp(:extent,         120.0))
    step_size      = Float64(gp(:step_size,      1.5))
    chemotaxis     = Float64(gp(:chemotaxis,     3.0))
    random_walk    = Float64(gp(:random_walk,    0.5))
    synapse_radius = Float64(gp(:synapse_radius, 3.0))
    max_steps      = Int(gp(:max_steps,      5000))
    run_id         = Int(gp(:run_id,         1))
    vtk_dir        = String(gp(:vtk_dir,        "vtk_output"))
    viz_csv        = String(gp(:viz_csv,        "simulation_viz.csv"))
    analysis_csv   = String(gp(:analysis_csv,   "simulation_analysis.csv"))

    return (neurons, chem_sources,
            seed, extent, step_size, chemotaxis, random_walk,
            synapse_radius, max_steps, run_id, vtk_dir, viz_csv, analysis_csv)
end

# =============================================================================
# Model initialisation
# =============================================================================

function init_model(neurons::OrderedDict{String,NeuronRecord},
                    chem_sources::Vector{ChemSource};
                    seed=1, run_id=1, extent=120.0,
                    step_size=1.5,
                    chemotaxis_strength=3.0,
                    random_walk_strength=0.5,
                    synapse_radius=3.0,
                    max_steps=5000,
                    vtk_dir="vtk_output")

    rng = MersenneTwister(seed)
    lo  = SVector{3,Float64}(0, 0, 0)
    hi  = SVector{3,Float64}(extent, extent, extent)

    # ── Row types for CSV buffers ─────────────────────────────────────────
    VizRow = NamedTuple{
        (:run_id,:agent_id,:agent_type,:neuron_id,:neurite_idx,:branch_idx,
         :timestep,:x,:y,:z,:connected_to,:synapse_formed,:branch_len,:stopped),
        Tuple{Int,Int,String,String,Int,Int,Int,Float64,Float64,Float64,Int,Int,Float64,Int}
    }
    AnalysisRow = NamedTuple{
        (:run_id,:agent_id,:neuron_id,:timestep,
         :net_grad_x,:net_grad_y,:net_grad_z,:net_grad_mag,:branch_len,:is_axon,:connected),
        Tuple{Int,Int,String,Int,Float64,Float64,Float64,Float64,Float64,Int,Int}
    }

    mkpath(vtk_dir)

    properties = Dict{Symbol,Any}(
        :rng                  => rng,
        :lo                   => lo,
        :hi                   => hi,
        :step_size            => step_size,
        :chemotaxis_strength  => chemotaxis_strength,
        :random_walk_strength => random_walk_strength,
        :synapse_radius       => synapse_radius,
        :max_steps            => max_steps,
        :t                    => 0,
        :run_id               => run_id,
        :neurons              => neurons,          # NeuronRecord store
        :chem_sources         => chem_sources,     # all chemical point sources
        :branch_prob          => 0.02,             # default; per-neuron stored in NeuronRecord
        :syn_graph            => SimpleGraph(0),
        :id_to_vertex         => Dict{Int,Int}(),
        :vertex_to_id         => Int[],
        :n_synapses           => 0,
        :next_branch_id       => 1,
        :viz_buffer           => Vector{VizRow}(),
        :analysis_buffer      => Vector{AnalysisRow}(),
        :vtk_dir              => vtk_dir,
        :pvd_buffer           => Vector{Tuple{Float64,String}}(),
    )

    space = ContinuousSpace((extent, extent, extent); periodic=false)

    model = StandardABM(
        Union{GrowthCone,Soma}, space;
        properties  = properties,
        rng         = rng,
        agent_step! = agent_step!,
        model_step! = model_step!,
    )

    # ── Normalise soma positions into [lo, hi] ───────────────────────────────
    # Input coordinates may use any origin (e.g. negative µm). Translate so
    # the population bounding box sits margin units inside the simulation box,
    # preserving all relative positions. Never magnify a small population.
    margin    = 5.0
    all_pos   = [nr.soma_pos for nr in values(neurons)]
    if isempty(all_pos)
        error("No neurons to simulate — neuron list is empty after parsing.")
    end
    data_min  = SVector{3,Float64}(minimum(p[i] for p in all_pos) for i in 1:3)
    data_max  = SVector{3,Float64}(maximum(p[i] for p in all_pos) for i in 1:3)
    data_span = data_max .- data_min
    box_span  = hi .- lo .- 2*margin
    scale     = min(1.0, minimum(box_span[i] / max(data_span[i], 1e-6) for i in 1:3))
    offset    = lo .+ margin .- data_min .* scale

    world(p::SVector{3,Float64}) =
        clamp_to_box(p .* scale .+ offset, lo .+ margin, hi .- margin)

    any(data_min[i] < lo[i] || data_max[i] > hi[i] for i in 1:3) &&
        println("  Note: soma positions translated into box " *
                "(scale=$(round(scale,digits=3)) " *
                "offset=$(round.(offset,digits=2)))")

    # Translate global chemical source positions by the same transform.
    chem_sources = [ChemSource(s.name, world(s.pos), s.sigma, s.strength)
                    for s in chem_sources]

    # Add per-neuron secretion sources at the translated soma positions.
    for (uid, nr) in neurons
        soma_w = world(nr.soma_pos)
        for chem in nr.releases
            push!(chem_sources, ChemSource(chem, soma_w, 40.0, 1.0))
        end
    end

    # ── Spawn agents ────────────────────────────────────────────────────
    for (uid, nr) in neurons
        soma_w = world(nr.soma_pos)

        add_agent!(soma_w, Soma, model,
                   SVector{3,Float64}(0,0,0),
                   uid, nr.morphology)

        for (ni, ns) in enumerate(nr.neurites)
            init_dir = azimuth_elevation_to_unit(ns.azimuth_deg, ns.elevation_deg)
            gc_pos   = clamp_to_box(soma_w + init_dir * step_size,
                                    lo .+ margin, hi .- margin)

            add_agent!(gc_pos, GrowthCone, model,
                       init_dir,
                       uid,
                       ni,
                       0,        # branch_idx (primary)
                       ns.is_axon,
                       0,        # connected_to
                       0.0,      # branch_len
                       false,    # stopped
                       copy(nr.attracts),
                       copy(nr.repels))
        end
    end

    return model
end

# =============================================================================
# Simulation runner
# =============================================================================

function run_simulation(json_str::AbstractString)
    (neurons, chem_sources,
     seed, extent, step_size, chemotaxis, random_walk,
     synapse_radius, max_steps, run_id, vtk_dir, viz_csv, analysis_csv) =
        parse_json_config(json_str)

    model = init_model(neurons, chem_sources;
        seed=seed, run_id=run_id, extent=extent,
        step_size=step_size,
        chemotaxis_strength=chemotaxis,
        random_walk_strength=random_walk,
        synapse_radius=synapse_radius,
        max_steps=max_steps,
        vtk_dir=vtk_dir)

    n_neurons   = length(neurons)

    if n_neurons == 0
        error("No neurons in config — send at least one neuron.")
    end

    total_gc    = sum(length(nr.neurites) for nr in values(neurons))
    n_axons     = sum(count(ns.is_axon for ns in nr.neurites) for nr in values(neurons))

    println("Run $run_id — $n_neurons neuron(s), $total_gc primary neurites ($n_axons axon(s))")
    for (uid, nr) in neurons
        println("  Neuron [$(uid[1:8])…] morphology=$(nr.morphology) " *
                "soma=$(nr.soma_pos) neurites=$(length(nr.neurites))")
        for (ni, ns) in enumerate(nr.neurites)
            role = ns.is_axon ? "AXON" : "dend"
            println("    [$ni] $role  az=$(ns.azimuth_deg)°  el=$(ns.elevation_deg)°")
        end
    end
    println()

    for step in 1:max_steps
        step!(model, 1)
        n_active = count(a isa GrowthCone && !a.stopped for a in allagents(model))
        step % 100 == 0 &&
            println("  step $step  synapses=$(model.n_synapses)  active_cones=$n_active")
        # Stop early once every growth cone has either synapsed or reached max length
        n_active == 0 && (println("  All cones stopped at step $step."); break)
    end

    flush_csv!(model.viz_buffer,      viz_csv)
    flush_csv!(model.analysis_buffer, analysis_csv)

    pvd_path    = joinpath(vtk_dir, "simulation.pvd")
    script_path = joinpath(vtk_dir, "load_in_paraview.py")
    write_pvd(model.pvd_buffer, pvd_path, vtk_dir)
    write_paraview_script(pvd_path, script_path)

    return Dict(
        "status"         => "ok",
        "run_id"         => run_id,
        "n_neurons"      => n_neurons,
        "total_neurites" => total_gc,
        "n_axons"        => n_axons,
        "synapses_formed"=> model.n_synapses,
        "vtk_dir"        => abspath(vtk_dir),
        "pvd_path"       => abspath(pvd_path),
        "viz_csv"        => abspath(viz_csv),
        "analysis_csv"   => abspath(analysis_csv),
    )
end

# =============================================================================
# HTTP server mode (unchanged interface)
# =============================================================================

function start_server(; host="0.0.0.0", port=8080)
    println("neurosim HTTP server on http://$host:$port")
    println("  POST /simulate  { ...neuron config... }")
    println("  GET  /health")
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
            return HTTP.Response(404, ["Content-Type"=>"application/json"],
                                 JSON3.write(Dict("error"=>"not found")))
        catch e
            msg = sprint(showerror, e)
            @warn "Request error: $msg"
            return HTTP.Response(500, ["Content-Type"=>"application/json"],
                                 JSON3.write(Dict("error"=>msg)))
        end
    end
end

# =============================================================================
# Entry point
# =============================================================================

function main(args)
    if length(args) >= 1 && args[1] == "serve"
        port = length(args) >= 2 ? parse(Int, args[2]) : 8080
        start_server(; port=port)
        return
    end

    config_path = length(args) >= 1 ? args[1] : "config.json"

    if !isfile(config_path)
        starter = """{
  "neurons": {
    "9678ff35-6672-4bb1-a34b-0b536cf25afb": {
      "soma": [-3.56, 4.58, 0],
      "morphology": "purkinje",
      "releases": ["BDNF"],
      "attracts": ["NT3"],
      "repels":   ["Sema3A"],
      "neurites": [[0, 0], [22, 22]]
    },
    "43c2e755-f86a-41f4-a444-f53423cda40b": {
      "soma": [-1.53, 4.17, 0],
      "morphology": "granule",
      "releases": ["NT3"],
      "attracts": ["BDNF"],
      "repels":   [],
      "neurites": [[0, 0]]
    }
  },
  "global_chemicals": {
    "BDNF": { "source": [60, 60, 0], "sigma": 40.0, "strength": 1.0 }
  },
  "params": {
    "seed": 1,
    "extent": 120.0,
    "step_size": 1.5,
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
        println("Edit it and re-run, or pass a path: julia neurosim.jl myconfig.json")
        exit(0)
    end

    result = run_simulation(read(config_path, String))
    println("\nOutput files:")
    println("  Visualization CSV → ", result["viz_csv"])
    println("  Analysis CSV      → ", result["analysis_csv"])
    println("  VTK frames        → ", result["vtk_dir"])
    println("  ParaView PVD      → ", result["pvd_path"])
    println("\nParaView: Tools > Python Shell > Run Script > load_in_paraview.py")
end

main(ARGS)
