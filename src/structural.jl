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

    # 4. Move active growth cones (gradient + tissue density + pause)
    move_growth_cones!(model)

    # 5. Retraction: probabilistically retract overextended cones
    check_retraction!(model)

    # 6. Branching: stochastic new branch sprouts
    check_branching!(model)

    # 7. Synapse formation: provisional contact checks
    check_synapse_formation!(model)

    # 8. Prune: remove synapses that have been weak too long
    prune_synapses!(model)

    # 9. Health decay, soma size update, death
    update_health!(model)

    # 10. Remove fully retracted growth cones
    remove_retracted!(model)
end

# ── Chemical field rebuild ─────────────────────────────────────────────────────

function rebuild_chemical_fields!(model)
    base_sources = model.base_chem_sources   # user-defined static sources
    dyn_sources  = ChemSource[]

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

    model.chem_sources = vcat(base_sources, dyn_sources)
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

function move_growth_cones!(model)
    rng       = model.rng
    step_size = model.step_size
    alpha     = model.chemotaxis_strength
    beta      = model.random_walk_strength

    for agent in allagents(model)
        agent isa GrowthCone || continue
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

        new_pos = clamp_to_box(pos + dir * step_size, model.lo, model.hi)
        move_agent!(agent, new_pos, model)

        # Record shaft trajectory for primary neurites
        if agent.branch_idx == 0
            push!(nr.neurites[agent.neurite_idx].trajectory,
                  (model.t, agent.pos))
        end

        agent.branch_len += step_size
    end
end

# ── Retraction ────────────────────────────────────────────────────────────────

function check_retraction!(model)
    rng = model.rng
    for agent in allagents(model)
        agent isa GrowthCone || continue
        agent.retracted && continue

        # Count stable synapses on this specific branch
        n_branch_syn = count(
            syn -> (syn.pre_gc_id == agent.id || syn.post_gc_id == agent.id) &&
                   syn.size > S_MIN_VIABLE,
            values(model.synapses)
        )

        pr = p_retract(agent.branch_len, n_branch_syn)
        rand(rng) < pr || continue

        # Retract one step along trajectory
        nr   = model.neurons[agent.neuron_id]
        traj = agent.branch_idx == 0 ? nr.neurites[agent.neurite_idx].trajectory :
               Vector{Tuple{Int,SVector{3,Float64}}}()

        if !isempty(traj)
            pop!(traj)
            agent.branch_len = max(0.0, agent.branch_len - model.step_size)
            if !isempty(traj)
                _, prev_pos = traj[end]
                move_agent!(agent, prev_pos, model)
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

# ── Branching ─────────────────────────────────────────────────────────────────

function check_branching!(model)
    rng = model.rng
    new_branches = NamedTuple[]

    # Collect as plain NamedTuples — do NOT construct GrowthCone agents here
    # (avoids mutating allagents during iteration, and avoids the removed nextid() API)
    for agent in allagents(model)
        agent isa GrowthCone        || continue
        agent.retracted             && continue
        agent.branch_idx != 0       && continue   # only primary cones spawn branches
        agent.branch_len < 0.02     && continue   # too close to soma to branch

        nr    = model.neurons[agent.neuron_id]
        bprob = nr.branch_prob * (1.0 - agent.branch_len / max(nr.L_target * 2, 0.1))
        bprob = max(0.0, bprob)
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
        add_agent!(b.pos, GrowthCone, model,
                   rand_unit_vec3(model.rng),
                   b.neuron_id, b.neurite_idx, b.branch_idx,
                   b.is_axon, 0, 0.0, false,
                   b.attracts, b.repels)
    end
end

# ── Synapse formation ─────────────────────────────────────────────────────────

function check_synapse_formation!(model)
    r_syn = model.synapse_radius
    for agent in allagents(model)
        agent isa GrowthCone     || continue
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
