# src/vtk_output.jl
# VTK frame writing — delta-only trajectory updates.
#
# Key optimisation: each frame writes ONLY the new trajectory segments added
# since the last frame. model.traj_written_lens tracks how many waypoints have
# already been serialised per (neuron_id, neurite_idx).
# Result: per-frame file size is O(new_waypoints), not O(cumulative_waypoints).

using WriteVTK, Printf

function init_vtk_tracking!(model)
    model.traj_written_lens = Dict{Tuple{String,Int},Int}()
end

function write_vtk_timestep!(model, vtk_dir)
    t      = model.t
    agents = collect(allagents(model))
    isempty(agents) && return

    all_pts     = Vector{SVector{3,Float32}}()
    type_arr    = Int32[]
    id_arr      = Int32[]
    radius_arr  = Float32[]
    health_arr  = Float32[]
    n_syn_arr   = Int32[]
    id_to_ptidx = Dict{Int,Int}()

    for a in agents
        push!(all_pts, SVector{3,Float32}(a.pos[1], a.pos[2], a.pos[3]))
        id_to_ptidx[a.id] = length(all_pts)
        push!(id_arr, Int32(a.id))
        if a isa Soma
            push!(type_arr,   a.dormant ? Int32(4) : Int32(0))
            push!(radius_arr, Float32(a.soma_radius))
            push!(health_arr, Float32(a.health))
            push!(n_syn_arr,  Int32(a.n_stable_syn))
        else
            push!(type_arr,   a.is_axon ? Int32(1) : Int32(2))
            push!(radius_arr, Float32(0.001))
            push!(health_arr, Float32(1.0))
            push!(n_syn_arr,  Int32(a.n_synapses))
        end
    end

    # Delta trajectory: only new waypoints since last write
    line_cells   = MeshCell[]
    written_lens = model.traj_written_lens

    for (uid, nr) in model.neurons
        for (ni, ns) in enumerate(nr.neurites)
            key      = (uid, ni)
            last_len = get(written_lens, key, 0)
            traj     = ns.trajectory
            cur_len  = length(traj)
            cur_len <= last_len && continue

            prev_pt_idx = 0
            # Include the last-written point as the handoff so segments are continuous
            if last_len > 0
                _, pos = traj[last_len]
                push!(all_pts, SVector{3,Float32}(pos[1], pos[2], pos[3]))
                prev_pt_idx = length(all_pts)
                push!(type_arr, Int32(3)); push!(id_arr, Int32(0))
                push!(radius_arr, Float32(0.0004))
                push!(health_arr, Float32(1.0)); push!(n_syn_arr, Int32(0))
            end

            for wi in (last_len + 1):cur_len
                _, pos = traj[wi]
                push!(all_pts, SVector{3,Float32}(pos[1], pos[2], pos[3]))
                new_idx = length(all_pts)
                push!(type_arr, Int32(3)); push!(id_arr, Int32(0))
                push!(radius_arr, Float32(0.0004))
                push!(health_arr, Float32(1.0)); push!(n_syn_arr, Int32(0))
                if prev_pt_idx > 0
                    push!(line_cells,
                          MeshCell(VTKCellTypes.VTK_LINE, [prev_pt_idx, new_idx]))
                end
                prev_pt_idx = new_idx
            end
            written_lens[key] = cur_len
        end
    end

    # Synapse edges
    for (_, syn) in model.synapses
        ia = get(id_to_ptidx, syn.pre_gc_id,  0)
        ib = get(id_to_ptidx, syn.post_gc_id, 0)
        ia != 0 && ib != 0 &&
            push!(line_cells, MeshCell(VTKCellTypes.VTK_LINE, [ia, ib]))
    end
    isempty(line_cells) &&
        push!(line_cells, MeshCell(VTKCellTypes.VTK_LINE, [1, 1]))

    n_pts = length(all_pts)
    pts   = zeros(Float32, 3, n_pts)
    for (i, p) in enumerate(all_pts)
        pts[1,i] = p[1]; pts[2,i] = p[2]; pts[3,i] = p[3]
    end

    fname = joinpath(vtk_dir, @sprintf("frame_%05d", t))
    vtk   = vtk_grid(fname, pts, line_cells)
    vtk["agent_type",  VTKPointData()] = type_arr
    vtk["agent_id",    VTKPointData()] = id_arr
    vtk["radius",      VTKPointData()] = radius_arr
    vtk["health",      VTKPointData()] = health_arr
    vtk["n_synapses",  VTKPointData()] = n_syn_arr
    saved = vtk_save(vtk)
    push!(model.pvd_buffer, (Float64(t), saved[1]))
end

function write_pvd(pvd_buf, pvd_path, vtk_dir)
    open(pvd_path, "w") do io
        println(io, """<?xml version="1.0"?>""")
        println(io, """<VTKFile type="Collection" version="0.1" byte_order="LittleEndian">""")
        println(io, "  <Collection>")
        for (t, fpath) in pvd_buf
            rel = relpath(fpath, dirname(pvd_path))
            println(io, """    <DataSet timestep="$t" group="" part="0" file="$rel"/>""")
        end
        println(io, "  </Collection>")
        println(io, "</VTKFile>")
    end
end

function write_paraview_script(pvd_path, script_path)
    pvd_abs = abspath(pvd_path)
    lines   = String[]
    push!(lines, "from paraview.simple import *")
    push!(lines, "pvd = OpenDataFile(r\"" * pvd_abs * "\")")
    push!(lines, "rv = GetActiveViewOrCreate('RenderView')")
    push!(lines, "rv.Background = [0.08, 0.08, 0.10]")
    push!(lines, "sphereSrc = Sphere()")
    push!(lines, "sphereSrc.ThetaResolution = 12; sphereSrc.PhiResolution = 10")
    push!(lines, "glyph = Glyph(Input=pvd, GlyphType=sphereSrc)")
    push!(lines, "glyph.ScaleArray = ['POINTS','radius']; glyph.ScaleFactor = 1.0")
    push!(lines, "glyph.GlyphMode = 'All Points'")
    push!(lines, "gd = Show(glyph, rv); gd.Representation = 'Surface'")
    push!(lines, "ColorBy(gd, ('POINTS','agent_type'))")
    push!(lines, "lut = GetColorTransferFunction('agent_type')")
    push!(lines, "lut.RGBPoints = [0,0.9,0.9,0.9, 1,0.3,0.6,0.9, 2,0.8,0.2,0.2, 3,0.45,0.45,0.45, 4,0.3,0.3,0.3]")
    push!(lines, "lut.ColorSpace = 'RGB'; gd.LookupTable = lut")
    push!(lines, "tube = Tube(Input=pvd); tube.Radius = 0.0003")
    push!(lines, "td = Show(tube, rv); td.Opacity = 0.65; td.LookupTable = lut")
    push!(lines, "ResetCamera()")
    push!(lines, "animScene = GetAnimationScene()")
    push!(lines, "animScene.UpdateAnimationUsingDataTimeSteps()")
    push!(lines, "Render(); Interact()")
    write(script_path, join(lines, "\n") * "\n")
end
