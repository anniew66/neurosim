# src/config_parser.jl
# Parses the full JSON config into NeuronRecord[], ChemSource[], TissueDensityGrid, params.
# Accepts both compact and full neuron formats.

using JSON3, OrderedCollections, StaticArrays

# ── Helpers ───────────────────────────────────────────────────────────────────

function azimuth_elevation_to_unit(az_deg, el_deg)
    az = deg2rad(az_deg); el = deg2rad(el_deg)
    SVector{3,Float64}(cos(el)*cos(az), cos(el)*sin(az), sin(el))
end

function rand_unit_vec3(rng)
    v = SVector{3,Float64}(randn(rng), randn(rng), randn(rng))
    n = norm(v); n > 0 ? v/n : SVector{3,Float64}(1,0,0)
end

function clamp_to_box(x, lo, hi)
    SVector{3,Float64}(clamp(x[1],lo[1],hi[1]),
                       clamp(x[2],lo[2],hi[2]),
                       clamp(x[3],lo[3],hi[3]))
end

function net_chemical_gradient(x, attracts, repels, sources)
    # Returns a unit-scale gradient vector.
    # Each source contributes a direction weighted by its local concentration
    # gradient magnitude. We use tanh saturation so:
    #   - very close sources don't dominate with infinite pull
    #   - the signal decays naturally with distance
    #   - multiple distributed sources produce a balanced field
    g = SVector{3,Float64}(0,0,0)
    for s in sources
        s.name in attracts || s.name in repels || continue
        d    = x - s.pos
        dist = sqrt(dot(d, d))
        dist < 1e-9 && continue   # exactly at source — no gradient
        d_hat = d / dist

        # Gradient magnitude of Gaussian: peaks at dist=sigma, tanh-saturated
        raw_g = s.strength * (dist / s.sigma^2) * exp(-dist^2 / (2*s.sigma^2))
        # Saturation: prevents near-source oscillation and single-source dominance
        sat_g = tanh(raw_g * 2.0)

        dir = sat_g * (-d_hat)   # point toward source
        g   = g + (s.name in attracts ? dir : -dir)
    end
    g
end

# ── build_neuron_record ───────────────────────────────────────────────────────

function build_neuron_record(rng, uid_str, soma_pos, morphology, angle_list,
                              releases, attracts, repels,
                              branch_prob, L_target,
                              start_time::Int,
                              is_input::Bool,
                              input_spec::InputSpec,
                              theta_ltd, theta_ltp, k_stab,
                              prune_delay_override)

    defs = morphology_defaults(morphology)
    bcm  = bcm_params(morphology)

    releases_f  = releases  !== nothing ? releases  : collect(defs.releases)
    attracts_f  = attracts  !== nothing ? attracts  : collect(defs.attracts)
    repels_f    = repels    !== nothing ? repels    : collect(defs.repels)
    bprob_f     = branch_prob !== nothing ? branch_prob : defs.branch_prob
    Ltarget_f   = L_target  !== nothing ? L_target  : defs.L_target
    θ_ltd_f     = theta_ltd !== nothing ? theta_ltd  : bcm.theta_ltd
    θ_ltp_f     = theta_ltp !== nothing ? theta_ltp  : bcm.theta_ltp
    k_stab_f    = k_stab    !== nothing ? k_stab     : bcm.k_stab
    prune_f     = prune_delay_override !== nothing ? prune_delay_override : PRUNE_DELAY_DEFAULT
    soma_r      = defs.soma_radius

    # Build neurites from angle list.
    # Empty list is fine — sprouting will generate neurites from gradients.
    raw_specs = NeuriteSpec[]
    for angles in angle_list
        az = Float64(angles[1]); el = Float64(angles[2])
        push!(raw_specs, NeuriteSpec(az, el, false,
              Vector{Tuple{Int,SVector{3,Float64}}}()))
    end

    # Input neurons: all pre-specified neurites are axons.
    # Network neurons: axon designation emerges during sprouting.
    # Pre-specified neurites: treat the first as axon if input, all as dendrites otherwise
    # (sprouting will assign the first sprout as the axon for network neurons).
    neurite_specs = [NeuriteSpec(ns.azimuth_deg, ns.elevation_deg,
                                  is_input,   # input = axon; network = dendrite (sprouting picks axon)
                                  ns.trajectory)
                     for ns in raw_specs]

    NeuronRecord(uid_str, soma_pos, morphology,
                 releases_f, attracts_f, repels_f,
                 neurite_specs, bprob_f, Ltarget_f, soma_r,
                 start_time, is_input, input_spec,
                 θ_ltd_f, θ_ltp_f, k_stab_f, prune_f, nothing)
end

# ── parse_input_spec ──────────────────────────────────────────────────────────

function parse_input_spec(raw_input)
    raw_input === nothing && return InputSpec()
    mode = Symbol(get(raw_input, :mode, "rate"))
    rate = Float64(get(raw_input, :rate, 0.0))
    seq_raw    = get(raw_input, :sequence, nothing)
    sequence   = seq_raw !== nothing ? Bool.(seq_raw) : Bool[]
    emit_chems = Bool(get(raw_input, :emit_chemicals, false))
    InputSpec(mode, rate, sequence, emit_chems)
end

# ── parse_json_config ─────────────────────────────────────────────────────────

function parse_json_config(json_str::AbstractString)
    raw = JSON3.read(json_str)
    tmp_rng = MersenneTwister(0)

    # ── Guard: old format ──────────────────────────────────────────────────────
    if haskey(raw, :growth_cones) || haskey(raw, :gc) || !haskey(raw, :neurons)
        error("Old config format. Delete config.json and re-run to generate a starter.")
    end
    if isempty(raw[:neurons])
        error("neurons object is empty — nothing to simulate.")
    end

    neurons      = OrderedDict{String,NeuronRecord}()
    chem_sources = ChemSource[]

    # ── Detect compact vs full ────────────────────────────────────────────────
    first_val  = first(values(raw[:neurons]))
    is_compact = first_val isa AbstractVector

    if is_compact
        neurites_map   = haskey(raw, :neurites)    ? raw[:neurites]    : Dict()
        morphology_map = haskey(raw, :morphologies) ? raw[:morphologies] : Dict()
        for (uid, pos_raw) in pairs(raw[:neurons])
            uid_str    = String(uid)
            soma_pos   = SVector{3,Float64}(Float64.(pos_raw)...)
            morphology = haskey(morphology_map, uid) ? String(morphology_map[uid]) : "generic"
            angle_list = haskey(neurites_map, uid)   ? neurites_map[uid]           : []
            neurons[uid_str] = build_neuron_record(
                tmp_rng, uid_str, soma_pos, morphology, angle_list,
                nothing, nothing, nothing, nothing, nothing,
                0, false, InputSpec(),
                nothing, nothing, nothing, nothing)
        end
    else
        for (uid, nd) in pairs(raw[:neurons])
            uid_str    = String(uid)
            soma_pos   = SVector{3,Float64}(Float64.(nd[:soma])...)
            morphology = haskey(nd, :morphology) ? String(nd[:morphology]) : "generic"
            angle_list = haskey(nd, :neurites)   ? nd[:neurites]           : []
            releases   = haskey(nd, :releases)   ? String.(nd[:releases])  : nothing
            attracts   = haskey(nd, :attracts)   ? String.(nd[:attracts])  : nothing
            repels     = haskey(nd, :repels)     ? String.(nd[:repels])    : nothing
            bprob      = haskey(nd, :branch_prob)    ? Float64(nd[:branch_prob])    : nothing
            Ltarget    = haskey(nd, :L_target)       ? Float64(nd[:L_target])       : nothing
            start_t    = haskey(nd, :start_time)     ? Int(nd[:start_time])         : 0
            is_input   = haskey(nd, :is_input)       ? Bool(nd[:is_input])          : false
            input_spec = parse_input_spec(haskey(nd, :input) ? nd[:input] : nothing)
            θ_ltd      = haskey(nd, :theta_ltd)      ? Float64(nd[:theta_ltd])      : nothing
            θ_ltp      = haskey(nd, :theta_ltp)      ? Float64(nd[:theta_ltp])      : nothing
            k_stab     = haskey(nd, :k_stab)         ? Float64(nd[:k_stab])         : nothing
            prune_del  = haskey(nd, :prune_delay)    ? Int(nd[:prune_delay])        : nothing

            neurons[uid_str] = build_neuron_record(
                tmp_rng, uid_str, soma_pos, morphology, angle_list,
                releases, attracts, repels, bprob, Ltarget,
                start_t, is_input, input_spec,
                θ_ltd, θ_ltp, k_stab, prune_del)
        end
    end

    # ── Global chemicals ──────────────────────────────────────────────────────
    if haskey(raw, :global_chemicals)
        for (cname, cd) in pairs(raw[:global_chemicals])
            push!(chem_sources, ChemSource(String(cname),
                  SVector{3,Float64}(Float64.(cd[:source])...),
                  Float64(cd[:sigma]), Float64(cd[:strength])))
        end
    end

    # ── Tissue density grid ───────────────────────────────────────────────────
    tissue_density = nothing
    if haskey(raw, :tissue_density) && raw[:tissue_density] !== nothing
        td = raw[:tissue_density]
        nx = Int(td[:nx]); ny = Int(td[:ny]); nz = Int(td[:nz])
        org = SVector{3,Float64}(Float64.(td[:origin])...)
        cs  = Float64(td[:cell_size])
        grid = TissueDensityGrid(nx, ny, nz, org, cs)
        raw_data = td[:data]
        for i in eachindex(raw_data)
            grid.data[i] = Float32(raw_data[i])
        end
        tissue_density = grid
    end

    # ── Simulation params ─────────────────────────────────────────────────────
    p    = haskey(raw, :params) ? raw[:params] : JSON3.read("{}")
    gp(k, d) = haskey(p, k) ? p[k] : d

    params = (
        seed                  = Int(gp(:seed,                1)),
        extent                = Float64(gp(:extent,              1.0)),
        step_size             = Float64(gp(:step_size,           0.003)),
        chemotaxis            = Float64(gp(:chemotaxis,          3.0)),
        random_walk           = Float64(gp(:random_walk,         0.5)),
        synapse_radius        = Float64(gp(:synapse_radius,      0.003)),
        max_steps             = Int(gp(:max_steps,           5000)),
        run_id                = Int(gp(:run_id,              1)),
        vtk_dir               = String(gp(:vtk_dir,             "vtk_output")),
        viz_csv               = String(gp(:viz_csv,             "simulation_viz.csv")),
        analysis_csv          = String(gp(:analysis_csv,        "simulation_analysis.csv")),
        synapse_csv           = String(gp(:synapse_csv,         "synapses.csv")),
        health_decay_rate     = Float64(gp(:health_decay_rate,   0.0002)),
        death_threshold       = Float64(gp(:death_threshold,     0.05)),
        synapse_health_boost  = Float64(gp(:synapse_health_boost,0.4)),
        prune_delay           = Int(gp(:prune_delay,         PRUNE_DELAY_DEFAULT)),
        n_struct              = Int(gp(:n_struct,            N_STRUCT)),
    )

    return neurons, chem_sources, tissue_density, params
end
