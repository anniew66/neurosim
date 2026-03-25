# src/vtk_output.jl
# VTK frame writing, PVD assembly, ParaView load script.

using WriteVTK, Printf, Graphs

function write_vtk_timestep!(model, vtk_dir)
    t       = model.t
    pvd_buf = model.pvd_buffer
    agents  = collect(allagents(model))
    isempty(agents) && return

    # ── Build point list: agents + neurite shaft points ─────────────────────
    all_pts    = Vector{SVector{3,Float32}}()
    type_arr   = Int32[]     # 0=soma,1=axon tip,2=dend tip,3=shaft,4=dormant soma
    id_arr     = Int32[]
    radius_arr = Float32[]
    health_arr = Float32[]
    n_syn_arr  = Int32[]

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
        else  # GrowthCone
            push!(type_arr,   a.is_axon ? Int32(1) : Int32(2))
            push!(radius_arr, Float32(0.001))
            push!(health_arr, Float32(1.0))
            push!(n_syn_arr,  Int32(a.n_synapses))
        end
    end

    # Shaft trajectory polylines
    line_cells = MeshCell[]
    soma_ptidx = Dict{String,Int}()
    for a in agents; a isa Soma && (soma_ptidx[a.neuron_id] = id_to_ptidx[a.id]); end
    gc_ptidx   = Dict{Tuple{String,Int,Int},Int}()
    for a in agents
        a isa GrowthCone && (gc_ptidx[(a.neuron_id, a.neurite_idx, a.branch_idx)] = id_to_ptidx[a.id])
    end

    for (uid, nr) in model.neurons
        s_idx = get(soma_ptidx, uid, 0); s_idx == 0 && continue
        for (ni, ns) in enumerate(nr.neurites)
            isempty(ns.trajectory) && continue
            shaft_ids = Int[]
            for (_, pos) in ns.trajectory
                push!(all_pts, SVector{3,Float32}(pos[1], pos[2], pos[3]))
                push!(shaft_ids, length(all_pts))
                push!(type_arr, Int32(3)); push!(id_arr, Int32(0))
                push!(radius_arr, Float32(0.0005))
                push!(health_arr, Float32(1.0)); push!(n_syn_arr, Int32(0))
            end
            tip_idx = get(gc_ptidx, (uid, ni, 0), 0)
            poly_pts = vcat([s_idx], shaft_ids, tip_idx != 0 ? [tip_idx] : Int[])
            length(poly_pts) >= 2 &&
                push!(line_cells, MeshCell(VTKCellTypes.VTK_POLY_LINE, poly_pts))
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

    # ── Assemble and write ────────────────────────────────────────────────────
    n_pts = length(all_pts)
    pts   = zeros(Float32, 3, n_pts)
    for (i, p) in enumerate(all_pts)
        pts[1,i]=p[1]; pts[2,i]=p[2]; pts[3,i]=p[3]
    end

    fname = joinpath(vtk_dir, @sprintf("frame_%05d", t))
    vtk   = vtk_grid(fname, pts, line_cells)
    vtk["agent_type",  VTKPointData()] = type_arr
    vtk["agent_id",    VTKPointData()] = id_arr
    vtk["radius",      VTKPointData()] = radius_arr
    vtk["health",      VTKPointData()] = health_arr
    vtk["n_synapses",  VTKPointData()] = n_syn_arr
    saved = vtk_save(vtk)
    push!(pvd_buf, (Float64(t), saved[1]))
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
    push!(lines, "")
    push!(lines, "pvd = OpenDataFile(r\"" * pvd_abs * "\")")
    push!(lines, "RenameSource('neurosim', pvd)")
    push!(lines, "renderView = GetActiveViewOrCreate('RenderView')")
    push!(lines, "renderView.Background = [0.1, 0.1, 0.12]")
    push!(lines, "")
    push!(lines, "# -- Sphere glyphs")
    push!(lines, "# agent_type: 0=soma  1=axon tip  2=dend tip  3=shaft  4=dormant soma")
    push!(lines, "sphereSrc = Sphere()")
    push!(lines, "sphereSrc.ThetaResolution = 14")
    push!(lines, "sphereSrc.PhiResolution   = 14")
    push!(lines, "glyph = Glyph(Input=pvd, GlyphType=sphereSrc)")
    push!(lines, "glyph.ScaleArray  = ['POINTS', 'radius']")
    push!(lines, "glyph.ScaleFactor = 1.0")
    push!(lines, "glyph.GlyphMode   = 'All Points'")
    push!(lines, "glyphDisp = Show(glyph, renderView)")
    push!(lines, "glyphDisp.Representation = 'Surface'")
    push!(lines, "ColorBy(glyphDisp, ('POINTS', 'agent_type'))")
    push!(lines, "lut = GetColorTransferFunction('agent_type')")
    push!(lines, "lut.RGBPoints = [")
    push!(lines, "    0.0,0.90,0.90,0.90,  # soma — light grey")
    push!(lines, "    1.0,0.29,0.56,0.89,  # axon tip — blue")
    push!(lines, "    2.0,0.75,0.22,0.17,  # dend tip — red")
    push!(lines, "    3.0,0.45,0.45,0.45,  # shaft — grey")
    push!(lines, "    4.0,0.30,0.30,0.30,  # dormant soma — dark grey")
    push!(lines, "]")
    push!(lines, "lut.ColorSpace = 'RGB'")
    push!(lines, "glyphDisp.LookupTable = lut")
    push!(lines, "glyphDisp.SetScalarBarVisibility(renderView, True)")
    push!(lines, "")
    push!(lines, "# -- Neurite shafts as tubes")
    push!(lines, "surf = ExtractSurface(Input=pvd)")
    push!(lines, "tube = Tube(Input=surf)")
    push!(lines, "tube.Radius = 0.0003")
    push!(lines, "try:")
    push!(lines, "    tube.NumberofSides = 6")
    push!(lines, "except AttributeError:")
    push!(lines, "    pass")
    push!(lines, "tubeDisp = Show(tube, renderView)")
    push!(lines, "tubeDisp.Representation = 'Surface'")
    push!(lines, "ColorBy(tubeDisp, ('POINTS', 'agent_type'))")
    push!(lines, "tubeDisp.LookupTable = lut")
    push!(lines, "tubeDisp.Opacity = 0.7")
    push!(lines, "")
    push!(lines, "# -- Health coloring option (uncomment to switch)")
    push!(lines, "# ColorBy(glyphDisp, ('POINTS', 'health'))")
    push!(lines, "# health_lut = GetColorTransferFunction('health')")
    push!(lines, "# health_lut.RGBPoints = [0.0,0.75,0.22,0.17, 0.5,0.95,0.77,0.06, 1.0,0.13,0.70,0.26]")
    push!(lines, "# glyphDisp.LookupTable = health_lut")
    push!(lines, "")
    push!(lines, "ResetCamera()")
    push!(lines, "animScene = GetAnimationScene()")
    push!(lines, "animScene.UpdateAnimationUsingDataTimeSteps()")
    push!(lines, "Render()")
    push!(lines, "print('NeuroSim: 0=soma 1=axon 2=dendrite 3=shaft 4=dormant -- Play to animate')")
    push!(lines, "Interact()")
    write(script_path, join(lines, "\n") * "\n")
end
