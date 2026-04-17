# src/structural.jl
# Structural step: runs every N_STRUCT electrical steps.
# Handles growth cone movement, retraction, branching, synapse formation/pruning,
# activity-dependent chemical field updates, start-time activation, health/death.

using LinearAlgebra
using StaticArrays

# ── Top-level structural step ─────────────────────────────────────────────────

function structural_step!(model, t_struct::Int)
    # 1. Apply BCM size updates accumulated over last N_STRUCT electrical steps
    apply_bcm_size_updates!(model)

    # 2. Rebuild chemical fields from current activity
    rebuild_chemical_fields!(model)

    # 3. Activate dormant neurons whose start_time has arrived
    activate_dormant_neurons!(model, t_struct)

    # ── Build typed agent caches (single allagents scan) ─────────────────────
    active_cones = GrowthCone[]
    active_somas = Soma[]
    cones_by_nid = Dict{String, Vector{GrowthCone}}()
    for a in allagents(model)
        if a isa GrowthCone && !a.retracted
            push!(active_cones, a)
            push!(get!(cones_by_nid, a.neuron_id, GrowthCone[]), a)
        elseif a isa Soma && !a.dormant
            push!(active_somas, a)
        end
    end

    # ── Build synapse-per-agent index (O(S) instead of O(G×S)) ───────────────
    gc_syn_counts = Dict{Int,Int}()
    for (_, syn) in model.synapses
        syn.size > S_MIN_VIABLE || continue
        gc_syn_counts[syn.pre_gc_id]  = get(gc_syn_counts, syn.pre_gc_id, 0) + 1
        gc_syn_counts[syn.post_gc_id] = get(gc_syn_counts, syn.post_gc_id, 0) + 1
    end

    # 4a. Sprout new growth cones from somas based on local gradients
    check_sprouting!(model, t_struct, active_somas, cones_by_nid)

    # 4b. Move active growth cones (gradient + tissue density + pause)
    move_growth_cones!(model, active_cones)

    # 5. Retraction: probabilistically retract overextended cones
    check_retraction!(model, active_cones, gc_syn_counts)

    # 6. Branching: stochastic new branch sprouts
    check_branching!(model, active_cones)

    # 7. Synapse formation: provisional contact checks
    check_synapse_formation!(model, active_cones)

    # 8. Prune: remove synapses that have been weak too long
    prune_synapses!(model)

    # 9. Health decay, soma size update, death
    update_health!(model)

    # 9b. Contact competition: retract redundant parallel dendrites
    check_cone_competition!(model, cones_by_nid)

    # 10. Remove fully retracted growth cones
    remove_retracted!(model)

    # Return counts so the main loop avoids extra allagents scans
    n_active = count(a -> !a.retracted, active_cones)
    return (n_active, length(active_somas))
end

# ── Chemical field rebuild ─────────────────────────────────────────────────────

function rebuild_chemical_fields!(model)
    base_sources = model.base_chem_sources   # user-defined static sources
    dyn_sources  = model.dyn_chem_buffer::Vector{ChemSource}
    empty!(dyn_sources)

    for (nid, nr) in model.neurons
        state = get(model.neuron_elec, nid, nothing)
        state === nothing && continue
        soma_id = get(model.soma_agent_ids, nid, 0)
        soma_id == 0 && continue
        soma = model[soma_id]
        soma.dormant && continue
        isempty(nr.releases) && continue

        fire_rate = state.fire_rate
        strength  = 1.0 + ACTIVITY_SCALE * fire_rate
        sigma     = CHEM_SIGMA_BASE

        # Reduce effective sigma in dense tissue
        ρ = eval_density(model.tissue_density, soma.pos[1], soma.pos[2], soma.pos[3])
        sigma_eff = sigma * (1.0 - K_COMPRESS * ρ)

        for chem in nr.releases
            push!(dyn_sources, ChemSource(chem, soma.pos, sigma_eff, strength))
        end
    end

    # Reuse chem_sources vector: overwrite with base + dynamic
    sources = model.chem_sources::Vector{ChemSource}
    empty!(sources)
    append!(sources, base_sources)
    append!(sources, dyn_sources)
end

# ── Activate dormant neurons ───────────────────────────────────────────────────

function activate_dormant_neurons!(model, t_struct::Int)
    for (nid, nr) in model.neurons
        nr.start_time > t_struct && continue
        soma_id = get(model.soma_agent_ids, nid, 0)
        soma_id == 0 && continue
        soma = model[soma_id]
        soma.dormant || continue
        soma.dormant = false
        # Initialise electrical state for newly activated neuron
        if !haskey(model.neuron_elec, nid)
            model.neuron_elec[nid] = NeuronElecState()
        end
    end
end

# ── Growth cone movement ───────────────────────────────────────────────────────

function move_growth_cones!(model, active_cones::Vector{GrowthCone})
    rng       = model.rng
    step_size = model.step_size
    alpha     = model.chemotaxis_strength
    beta      = model.random_walk_strength

    for agent in active_cones
        agent.retracted && continue

        soma_id = get(model.soma_agent_ids, agent.neuron_id, 0)
        soma_id == 0 && continue
        model[soma_id].dormant && continue

        pos = agent.pos
        ρ   = eval_density(model.tissue_density, pos[1], pos[2], pos[3])

        # Pause probability increased by tissue density
        p_pause = P_PAUSE_BASE + K_PAUSE * ρ
        rand(rng) < p_pause && continue

        # Chemical gradient
        nr    = model.neurons[agent.neuron_id]
        g     = net_chemical_gradient(pos, nr.attracts, nr.repels, model.chem_sources)

        # Gradient noise from tissue density
        if ρ > 0.01
            noise = SVector{3,Float64}(randn(rng), randn(rng), randn(rng)) * K_NOISE * ρ
            g     = g + noise
        end

        dir = SVector{3,Float64}(0, 0, 0)
        norm(g) > 1e-12 && (dir = alpha * (g / norm(g)))

        # Effective random walk boosted by tortuosity
        β_eff = beta * (1.0 + K_TORTUOSITY * ρ)
        dir   = dir + β_eff * rand_unit_vec3(rng)
        dir   = norm(dir) > 1e-12 ? dir / norm(dir) : rand_unit_vec3(rng)

        # Blend with previous direction for persistence (reduces self-wrapping)
        prev_dir = agent.vel
        if norm(prev_dir) > 1e-12
            dir = PERSISTENCE_LAMBDA * prev_dir + (1.0 - PERSISTENCE_LAMBDA) * dir
            dir = norm(dir) > 1e-12 ? dir / norm(dir) : rand_unit_vec3(rng)
        end

        # Boundary slide — if near a wall and heading into it, zero out the
        # inward component so the cone slides along the wall instead of piling
        # up in an equilibrium zone. Margin scales with step_size so this
        # behaves correctly regardless of the domain extent.
        lo = model.lo; hi = model.hi
        margin = step_size * 2.0
        clamped = MVector{3,Float64}(dir[1], dir[2], dir[3])
        @inbounds for d in 1:3
            if pos[d] - lo[d] < margin && clamped[d] < 0
                clamped[d] = 0.0
            end
            if hi[d] - pos[d] < margin && clamped[d] > 0
                clamped[d] = 0.0
            end
        end
        dir = SVector{3,Float64}(clamped)
        dir = norm(dir) > 1e-12 ? dir / norm(dir) : rand_unit_vec3(rng)

        raw_pos = pos + dir * step_size
        new_pos, new_dir = reflect_at_bounds(raw_pos, dir, model.lo, model.hi)
        move_agent!(agent, new_pos, model)
        agent.vel = new_dir

        # Record trajectory waypoint. Primary cones write to the shared
        # NeuriteSpec.trajectory on the NeuronRecord; branched cones write to
        # their own per-agent branch_trajectory so check_retraction! can pop.
        # Only append if position changed (avoid duplicate waypoints on pause).
        if agent.branch_idx == 0
            traj = nr.neurites[agent.neurite_idx].trajectory
            if isempty(traj) || norm(agent.pos - traj[end][2]) > model.step_size * 0.1
                push!(traj, (model.t, agent.pos))
            end
        else
            traj = agent.branch_trajectory
            if isempty(traj) || norm(agent.pos - traj[end][2]) > model.step_size * 0.1
                push!(traj, (model.t, agent.pos))
            end
        end

        agent.branch_len += step_size
    end
end

# ── Retraction ────────────────────────────────────────────────────────────────

function check_retraction!(model, active_cones::Vector{GrowthCone},
                           gc_syn_counts::Dict{Int,Int})
    rng = model.rng
    for agent in active_cones
        agent.retracted && continue

        n_branch_syn = get(gc_syn_counts, agent.id, 0)

        pr = p_retract(agent.branch_len, n_branch_syn)
        rand(rng) < pr || continue

        # Retract one step along trajectory.  Primary cones share the
        # NeuriteSpec.trajectory on the NeuronRecord; branched cones own
        # their own branch_trajectory.
        nr   = model.neurons[agent.neuron_id]
        traj = agent.branch_idx == 0 ?
               nr.neurites[agent.neurite_idx].trajectory :
               agent.branch_trajectory

        if !isempty(traj)
            pop!(traj)
            agent.branch_len = max(0.0, agent.branch_len - model.step_size)
            if !isempty(traj)
                _, prev_pos = traj[end]
                move_agent!(agent, prev_pos, model)
            end

            # Bump the per-model retraction counter so the viewer knows to
            # resync trajectories.
            model.retraction_count += 1

            # Reset the VTK delta cache for primary cones so the next frame
            # re-emits the now-shorter trajectory instead of skipping it.
            if agent.branch_idx == 0
                key = (agent.neuron_id, agent.neurite_idx)
                written = model.traj_written_lens
                written[key] = min(get(written, key, 0), length(traj))
            end
        else
            agent.branch_len = max(0.0, agent.branch_len - model.step_size)
        end

        # Fully retracted: mark for removal
        if agent.branch_len <= 0.001
            agent.retracted = true
        end
    end
end


# ── Gradient-based neurite sprouting ──────────────────────────────────────────
# Each structural step, each soma evaluates the local chemical gradient.
# With some probability it sprouts a new growth cone in the gradient direction.
# The FIRST sprout becomes the axon (longest reach); subsequent ones are dendrites.
# This replaces pre-assigned neurite angles in the JSON config.

# ── Sprouting constants ────────────────────────────────────────────────────────
const MAX_DENDRITES        = 5       # max dendrite cones (axon is separate)
const SPROUT_INTERVAL      = 20      # structural steps between sprout attempts
const K_TERRITORY          = 4.0     # territory cone scale: θ = atan(K*r / L)
# Minimum territory angle even for very long branches (prevents total collapse)
const MIN_TERRITORY_DEG    = 15.0
const AXON_NOISE           = 0.20    # low → axon committed to gradient
const DEND_NOISE_BASE      = 0.5     # tangential spread noise for dendrites

# Compute the territory half-angle (radians) claimed by a branch of length L
# using soma radius r as a proxy for process diameter.
# Wide when short (new branch claims large cone), narrows as branch grows.
function territory_angle(branch_len::Float64, soma_radius::Float64)::Float64
    min_rad = deg2rad(MIN_TERRITORY_DEG)
    max(atan(K_TERRITORY * soma_radius / max(branch_len, soma_radius * 0.5)), min_rad)
end

# True if proposed direction `d` falls inside the territory cone of `cone`
# (cone pointing from soma toward cone.pos, territory angle from its branch_len)
function in_territory(d::SVector{3,Float64}, cone_dir::SVector{3,Float64},
                      cone_len::Float64, soma_radius::Float64)::Bool
    θ = territory_angle(cone_len, soma_radius)
    # dot product = cos(angle between directions)
    dot(d, cone_dir) > cos(θ)
end

# Generate N evenly-spread tangent directions around axis `ax`, with noise σ
function spread_directions(ax::SVector{3,Float64}, n::Int,
                           σ::Float64, rng)::Vector{SVector{3,Float64}}
    # Build an orthonormal basis perpendicular to ax
    ref = abs(ax[1]) < 0.9 ? SVector{3,Float64}(1,0,0) : SVector{3,Float64}(0,1,0)
    u   = normalize(cross(ax, ref))
    v   = normalize(cross(ax, u))
    dirs = SVector{3,Float64}[]
    for i in 0:(n-1)
        φ = 2π * i / n + randn(rng) * 0.3   # even spacing + jitter
        # Tilt away from axon by ~90-140 degrees (into dendritic hemisphere)
        tilt = π * (0.55 + rand(rng) * 0.35)  # 100°–163° from axon
        base = cos(tilt) * ax + sin(tilt) * (cos(φ)*u + sin(φ)*v)
        noise_vec = SVector{3,Float64}(randn(rng), randn(rng), randn(rng)) * σ
        d = base + noise_vec
        nd = norm(d) > 1e-12 ? d / norm(d) : rand_unit_vec3(rng)
        push!(dirs, nd)
    end
    dirs
end

function check_sprouting!(model, t_struct::Int,
                          active_somas::Vector{Soma},
                          cones_by_nid::Dict{String, Vector{GrowthCone}})
    t_struct % SPROUT_INTERVAL == 0 || return
    rng = model.rng

    for agent in active_somas
        nid = agent.neuron_id
        nr  = model.neurons[nid]
        pos = agent.pos

        # Gather all active cones from pre-built index
        raw_cones = [a for a in get(cones_by_nid, nid, GrowthCone[])
                     if !a.retracted]
        existing = [(normalize(a.pos - pos + SVector{3,Float64}(1e-9,0,0)),
                     a.branch_len, a.is_axon) for a in raw_cones]
        n_axons = count(x -> x[3],  existing)
        n_dends = count(x -> !x[3], existing)

        # ── Soma radius for territory calculation ────────────────────────────
        soma_r = nr.soma_radius_base

        g       = net_chemical_gradient(pos, nr.attracts, nr.repels, model.chem_sources)
        g_mag   = norm(g)
        g_hat   = g_mag > 1e-12 ? g / g_mag : rand_unit_vec3(rng)

        # ── AXON: ensure exactly one per neuron ─────────────────────────────
        if n_axons == 0
            p_axon = g_mag > 1e-10 ? 0.18 : (t_struct > 40 ? 0.06 : 0.015)
            if rand(rng) < p_axon
                noise    = SVector{3,Float64}(randn(rng), randn(rng), randn(rng)) * AXON_NOISE
                dir      = g_hat + noise
                dir_norm = norm(dir) > 1e-12 ? dir / norm(dir) : rand_unit_vec3(rng)

                # Axon must not be within 90° of any existing dendrite
                axon_blocked_by_dend = any(dot(dir_norm, ed) > 0.0
                                           for (ed, _, is_ax) in existing if !is_ax)
                # Also check territory for non-strong signals
                blocked = axon_blocked_by_dend ||
                          (g_mag < 0.5 && any(in_territory(dir_norm, ed, el, soma_r)
                                              for (ed, el, _) in existing))
                if !blocked
                    az = rad2deg(atan(dir_norm[2], dir_norm[1]))
                    el_deg = rad2deg(asin(clamp(dir_norm[3], -1.0, 1.0)))
                    push!(nr.neurites, NeuriteSpec(az, el_deg, true,
                          Vector{Tuple{Int,SVector{3,Float64}}}()))
                    ni = length(nr.neurites)
                    gc_pos, _ = reflect_at_bounds(pos + dir_norm * model.step_size, dir_norm, model.lo, model.hi)
                    add_agent!(gc_pos, GrowthCone, model,
                               dir_norm, nid, ni, 0, true, 0, 0.0, false,
                               copy(nr.attracts), copy(nr.repels),
                               Vector{Tuple{Int,SVector{3,Float64}}}())
                    # Record axon direction so dendrites can enforce polarity
                    nr.axon_dir = dir_norm
                end
            end
            continue   # one action per step: axon OR dendrite, not both
        end

        # ── DENDRITES: spread evenly around cell, biased away from axon ─────
        n_dends >= MAX_DENDRITES && continue
        p_sprout = 0.012 + 0.04 * tanh(g_mag * 2.0)
        rand(rng) < p_sprout || continue

        # How many new dendrites to attempt this step (usually 1)
        n_want = min(2, MAX_DENDRITES - n_dends)

        # Use stored axon direction as the pole to spread dendrites opposite to.
        # If axon not yet committed, use gradient direction as proxy.
        axon_pole = nr.axon_dir !== nothing ? nr.axon_dir : g_hat

        # Generate candidate directions spread around the axon axis
        # (tilt 100°-163° away from axon → dendritic hemisphere)
        candidates = spread_directions(axon_pole, n_want * 3, DEND_NOISE_BASE, rng)

        added = 0
        for dir_norm in candidates
            added >= n_want && break

            # ── Hard polarity constraint: dendrites must be > 90° from axon ──
            # dot(dendrite, axon) > 0 means angle < 90° → reject
            if dot(dir_norm, axon_pole) > 0.0
                continue
            end

            # Also reject if < 75° from any OTHER dendrite's direction (spread)
            too_crowded = any(dot(dir_norm, ed) > cos(deg2rad(75.0))
                              for (ed, _, is_ax) in existing if !is_ax)
            too_crowded && continue

            # Territory exclusion: reject if inside any existing cone's territory
            blocked = any(in_territory(dir_norm, ed, el, soma_r)
                          for (ed, el, _) in existing)
            blocked && continue

            az = rad2deg(atan(dir_norm[2], dir_norm[1]))
            el = rad2deg(asin(clamp(dir_norm[3], -1.0, 1.0)))
            push!(nr.neurites, NeuriteSpec(az, el, false,
                  Vector{Tuple{Int,SVector{3,Float64}}}()))
            ni = length(nr.neurites)
            gc_pos, _ = reflect_at_bounds(pos + dir_norm * model.step_size, dir_norm, model.lo, model.hi)
            add_agent!(gc_pos, GrowthCone, model,
                       dir_norm, nid, ni, 0, false, 0, 0.0, false,
                       copy(nr.attracts), copy(nr.repels),
                       Vector{Tuple{Int,SVector{3,Float64}}}())
            # Add to existing so next candidate respects this new cone's territory
            push!(existing, (dir_norm, model.step_size, false))
            added += 1
        end
    end
end

# ── Territory-based cone competition ──────────────────────────────────────────
# For each pair of same-type cones of the same neuron, if one's territory cone
# fully contains the other's direction, the shorter one is retracted.
# This is O(n_cones²) per neuron but neurons have ≤ MAX_DENDRITES+1 cones.
function check_cone_competition!(model, cones_by_nid::Dict{String, Vector{GrowthCone}})
    to_retract = Set{Int}()
    for (nid, cones) in cones_by_nid
        length(cones) < 2 && continue
        soma_id = get(model.soma_agent_ids, nid, 0)
        soma_id == 0 && continue
        soma_pos = model[soma_id].pos
        soma_r   = model.neurons[nid].soma_radius_base

        for i in 1:length(cones)
            cones[i].retracted && continue
            cones[i].id in to_retract && continue
            for j in (i+1):length(cones)
                cones[j].retracted && continue
                cones[j].id in to_retract && continue
                # Only compete same-type
                cones[i].is_axon == cones[j].is_axon || continue
                cones[i].is_axon && continue  # axons don't compete with each other

                di = normalize(cones[i].pos - soma_pos + SVector{3,Float64}(1e-9,0,0))
                dj = normalize(cones[j].pos - soma_pos + SVector{3,Float64}(1e-9,0,0))

                li = cones[i].branch_len; lj = cones[j].branch_len

                # If i's territory contains j's direction → j is in i's shadow
                if in_territory(dj, di, li, soma_r)
                    # Longer branch wins; shorter retracts
                    loser = li >= lj ? cones[j].id : cones[i].id
                    push!(to_retract, loser)
                elseif in_territory(di, dj, lj, soma_r)
                    loser = lj >= li ? cones[i].id : cones[j].id
                    push!(to_retract, loser)
                end
            end
        end
    end

    for id in to_retract
        hasid(model, id) && (model[id].retracted = true)
    end
end

# ── Branching ─────────────────────────────────────────────────────────────────

function check_branching!(model, active_cones::Vector{GrowthCone})
    rng = model.rng
    new_branches = NamedTuple[]

    for agent in active_cones
        agent.retracted             && continue
        agent.branch_idx != 0       && continue   # only primary cones spawn branches
        agent.branch_len < 0.01     && continue   # too close to soma to branch

        nr    = model.neurons[agent.neuron_id]
        bprob = nr.branch_prob * max(0.3, 1.0 - agent.branch_len / max(nr.L_target * 3, 0.3))
        rand(rng) < bprob || continue

        traj = nr.neurites[agent.neurite_idx].trajectory
        isempty(traj) && continue
        _, branch_origin = traj[rand(rng, 1:length(traj))]

        branch_id = model.next_branch_id
        model.next_branch_id += 1

        push!(new_branches, (
            pos          = branch_origin,
            neuron_id    = agent.neuron_id,
            neurite_idx  = agent.neurite_idx,
            branch_idx   = branch_id,
            is_axon      = agent.is_axon,
            attracts     = copy(nr.attracts),
            repels       = copy(nr.repels),
        ))
    end

    for b in new_branches
        # Branched cones get an initial waypoint at their spawn position so
        # check_retraction! has something to pop back to.
        traj0 = Vector{Tuple{Int,SVector{3,Float64}}}()
        push!(traj0, (model.t, b.pos))
        add_agent!(b.pos, GrowthCone, model,
                   rand_unit_vec3(model.rng),
                   b.neuron_id, b.neurite_idx, b.branch_idx,
                   b.is_axon, 0, 0.0, false,
                   b.attracts, b.repels,
                   traj0)
    end
end

# ── Synapse formation ─────────────────────────────────────────────────────────

function check_synapse_formation!(model, active_cones::Vector{GrowthCone})
    r_syn = model.synapse_radius
    for agent in active_cones
        agent.is_axon            || continue
        agent.retracted          && continue

        soma_id = get(model.soma_agent_ids, agent.neuron_id, 0)
        soma_id == 0 && continue
        model[soma_id].dormant && continue

        axon_neuron = model.neurons[agent.neuron_id]

        for other in nearby_agents(agent, model, r_syn)
            # Axon → Dendrite GrowthCone contact
            if other isa GrowthCone && !other.is_axon && !other.retracted
                other_soma_id = get(model.soma_agent_ids, other.neuron_id, 0)
                other_soma_id == 0 && continue
                model[other_soma_id].dormant && continue

                # Don't self-synapse
                agent.neuron_id == other.neuron_id && continue

                # Chemical compatibility check
                dend_neuron = model.neurons[other.neuron_id]
                compatible  = is_compatible(axon_neuron, dend_neuron)
                compatible || continue

                # Allow multiple provisional contacts (competition model)
                # But cap at a reasonable number to avoid explosion
                agent.n_synapses < 8 || continue

                # Estimate dendritic path distance to soma
                dist = estimate_distance(other, model)
                form_synapse!(model, agent, other, false, dist)

            # Axosomatic contact (axon → soma directly)
            elseif other isa Soma && !other.dormant
                other.neuron_id == agent.neuron_id && continue
                dend_neuron = model.neurons[other.neuron_id]
                dend_neuron.is_input && continue  # input neurons reject incoming axons
                compatible = is_compatible(axon_neuron, model.neurons[other.neuron_id])
                compatible || continue
                agent.n_synapses < 8 || continue
                dist = estimate_distance_soma(other, model)
                form_synapse!(model, agent, other, true, dist)
            end
        end
    end
end

function is_compatible(axon_nr::NeuronRecord, dend_nr::NeuronRecord)::Bool
    isempty(axon_nr.releases) || isempty(dend_nr.attracts) ||
    !isempty(intersect(axon_nr.releases, dend_nr.attracts))
end

function estimate_distance(gc::GrowthCone, model)::Float64
    # Use branch_len as a proxy for dendritic path distance
    max(gc.branch_len, 0.001)
end

function estimate_distance_soma(soma::Soma, model)::Float64
    0.001  # axosomatic: essentially 0 distance (at soma)
end

function form_synapse!(model, pre_gc, post_agent, is_axosomatic::Bool, dist::Float64)
    syn_id = model.next_synapse_id
    model.next_synapse_id += 1

    post_nid = post_agent isa GrowthCone ? post_agent.neuron_id :
               post_agent isa Soma       ? post_agent.neuron_id : return

    syn = SynapseRecord(syn_id,
                        pre_gc.neuron_id, post_nid,
                        pre_gc.id, post_agent.id,
                        is_axosomatic, dist)

    model.synapses[syn_id]  = syn
    pre_gc.n_synapses       += 1

    # Register in lookup maps
    push!(get!(model.pre_synapses,  pre_gc.neuron_id, Int[]), syn_id)
    push!(get!(model.post_synapses, post_nid,          Int[]), syn_id)

    println("  Provisional synapse $(syn_id): " *
            "$(pre_gc.neuron_id[1:8])→$(post_nid[1:8]) d=$(round(dist,digits=3))mm")
end

# ── Synapse pruning ────────────────────────────────────────────────────────────

function prune_synapses!(model)
    to_prune = Int[]
    for (sid, syn) in model.synapses
        if syn.size < S_MIN_VIABLE
            syn.k_weak += 1
            if syn.k_weak > model.prune_delay
                push!(to_prune, sid)
            end
        else
            syn.k_weak = 0
        end
    end

    for sid in to_prune
        syn = model.synapses[sid]
        # Decrement n_synapses on presynaptic GrowthCone if still alive
        if hasid(model, syn.pre_gc_id)
            gc = model[syn.pre_gc_id]
            gc isa GrowthCone && (gc.n_synapses = max(0, gc.n_synapses - 1))
        end
        delete!(model.synapses, sid)
        # Remove from lookup maps
        filter!(s -> s != sid, get(model.pre_synapses,  syn.pre_neuron_id, Int[]))
        filter!(s -> s != sid, get(model.post_synapses, syn.post_neuron_id, Int[]))
        println("  Pruned synapse $(sid)")
    end

    # Update stable synapse count on somas
    for (nid, soma_id) in model.soma_agent_ids
        hasid(model, soma_id) || continue
        soma = model[soma_id]
        soma isa Soma || continue
        stable = count(sid -> begin
                    syn = get(model.synapses, sid, nothing)
                    syn !== nothing && syn.size > S_MIN_VIABLE * 3
                 end, get(model.post_synapses, nid, Int[]))
        soma.n_stable_syn = stable
    end
end

# ── Health and death ───────────────────────────────────────────────────────────

function update_health!(model)
    dead = String[]
    for (nid, _) in model.neurons
        soma_id = get(model.soma_agent_ids, nid, 0)
        soma_id == 0 && continue
        hasid(model, soma_id) || continue
        soma = model[soma_id]
        soma isa Soma || continue
        soma.dormant && continue

        soma.health -= model.health_decay_rate

        # Stable synapses boost health
        syn_boost = model.synapse_health_boost * min(soma.n_stable_syn, 10) / 10.0
        soma.health = min(1.0, soma.health + syn_boost)

        # Update soma radius: shrinks when unhealthy, grows with synapses
        nr    = model.neurons[nid]
        h_sc  = 0.3 + 0.7 * max(0.0, soma.health)
        s_sc  = 1.0 + 0.08 * min(soma.n_stable_syn, 10)
        soma.soma_radius = nr.soma_radius_base * h_sc * s_sc

        soma.health < model.death_threshold && push!(dead, nid)
    end

    for nid in dead
        remove_neuron!(model, nid)
    end
end

function remove_neuron!(model, nid::String)
    # Archive neuron record + last soma position before destruction
    if haskey(model.neurons, nid)
        nr = model.neurons[nid]
        soma_aid = get(model.soma_agent_ids, nid, nothing)
        if soma_aid !== nothing && hasid(model, soma_aid)
            nr.soma_pos = model[soma_aid].pos
        end
        model.dead_neurons[nid] = nr
        model.dead_neuron_deaths[nid] = model.t
    end

    to_remove = [a.id for a in allagents(model)
                 if (a isa Soma && a.neuron_id == nid) ||
                    (a isa GrowthCone && a.neuron_id == nid)]
    for aid in to_remove
        hasid(model, aid) && remove_agent!(aid, model)
    end
    delete!(model.neurons, nid)
    delete!(model.soma_agent_ids, nid)
    delete!(model.neuron_elec, nid)
    # Remove all synapses involving this neuron
    dead_syns = [sid for (sid, syn) in model.synapses
                 if syn.pre_neuron_id == nid || syn.post_neuron_id == nid]
    for sid in dead_syns
        delete!(model.synapses, sid)
    end
    delete!(model.pre_synapses, nid)
    delete!(model.post_synapses, nid)
    println("  Neuron $(nid[1:8]) died.")
end

# ── Remove fully retracted cones ───────────────────────────────────────────────

function remove_retracted!(model)
    to_remove = [a.id for a in allagents(model)
                 if a isa GrowthCone && a.retracted]
    for aid in to_remove
        hasid(model, aid) && remove_agent!(aid, model)
    end
end
