# src/electrical.jl
# Electrical step functions: integrate-and-fire, synaptic integration,
# BCM/NMDA plasticity, synapse size dynamics.
# Runs N_STRUCT times per structural step at dt = 1 ms resolution.
#
# Architecture: struct-of-arrays (ElecArrays) for the 100-substep inner loop.
# Index mappings are rebuilt only when the neuron/synapse topology changes.
# Between topology changes, only mutable values are synced (near-zero alloc).

using LinearAlgebra

# ══════════════════════════════════════════════════════════════════════════════
# Topology change detection
# ══════════════════════════════════════════════════════════════════════════════

function needs_rebuild(ea::ElecArrays, neuron_elec::Dict{String,NeuronElecState},
                       synapses::Dict{Int,SynapseRecord})::Bool
    ea.n_neurons == 0 && return true
    length(neuron_elec) != ea.n_neurons && return true
    length(synapses) != ea.n_synapses && return true
    @inbounds for j in 1:ea.n_synapses
        haskey(synapses, ea.idx_to_sid[j]) || return true
    end
    @inbounds for i in 1:ea.n_neurons
        haskey(neuron_elec, ea.idx_to_nid[i]) || return true
    end
    false
end

# ══════════════════════════════════════════════════════════════════════════════
# Full rebuild — called only when topology changes
# ══════════════════════════════════════════════════════════════════════════════

function build_elec_arrays!(ea::ElecArrays, model,
                            neuron_elec::Dict{String,NeuronElecState},
                            synapses::Dict{Int,SynapseRecord})
    neurons  = model.neurons
    soma_ids = model.soma_agent_ids

    # ── Neuron index mapping (no sort needed — order is arbitrary) ────────
    N = length(neuron_elec)
    ea.n_neurons = N

    resize!(ea.V, N); resize!(ea.refractory, N); resize!(ea.fired, N)
    resize!(ea.fire_rate, N); resize!(ea.fire_count, N)
    resize!(ea.is_input, N); resize!(ea.is_active, N)
    resize!(ea.seq_ptr, N); resize!(ea.input_mode, N); resize!(ea.input_rate, N)
    resize!(ea.input_seq, N); resize!(ea.idx_to_nid, N); resize!(ea.V_input, N)

    empty!(ea.nid_to_idx)
    sizehint!(ea.nid_to_idx, N)

    i = 0
    for (nid, state) in neuron_elec
        i += 1
        ea.idx_to_nid[i] = nid
        ea.nid_to_idx[nid] = i

        ea.V[i]          = state.V
        ea.refractory[i] = state.refractory
        ea.fired[i]      = state.fired
        ea.fire_rate[i]  = state.fire_rate
        ea.fire_count[i] = 0   # reset for this substep block
        ea.seq_ptr[i]    = state.seq_ptr

        nr      = get(neurons, nid, nothing)
        soma_id = get(soma_ids, nid, 0)::Int
        dormant = (soma_id == 0) || model[soma_id].dormant

        ea.is_active[i] = !dormant && nr !== nothing
        ea.is_input[i]  = nr !== nothing && nr.is_input && !dormant

        if ea.is_input[i]
            ea.input_mode[i] = nr.input_spec.mode
            ea.input_rate[i] = nr.input_spec.rate
            ea.input_seq[i]  = nr.input_spec.sequence
        else
            ea.input_mode[i] = :rate
            ea.input_rate[i] = 0.0
            ea.input_seq[i]  = Bool[]
        end
    end

    # ── Synapse index mapping — reuse _sid_buf to avoid allocation ────────
    sid_buf = ea._sid_buf
    empty!(sid_buf)
    sizehint!(sid_buf, length(synapses))
    for (sid, syn) in synapses
        haskey(ea.nid_to_idx, syn.pre_neuron_id)  || continue
        haskey(ea.nid_to_idx, syn.post_neuron_id) || continue
        push!(sid_buf, sid)
    end

    S = length(sid_buf)
    ea.n_synapses = S

    resize!(ea.pre_idx, S); resize!(ea.post_idx, S); resize!(ea.syn_size, S)
    resize!(ea.attenuation, S); resize!(ea.decay, S); resize!(ea.V_syn, S)
    resize!(ea.c_i, S); resize!(ea.c_bar, S); resize!(ea.sigma_stab, S)
    resize!(ea.idx_to_sid, S)

    empty!(ea.sid_to_idx)
    sizehint!(ea.sid_to_idx, S)

    @inbounds for j in 1:S
        sid = sid_buf[j]
        syn = synapses[sid]
        ea.idx_to_sid[j]  = sid
        ea.sid_to_idx[sid] = j
        ea.pre_idx[j]     = ea.nid_to_idx[syn.pre_neuron_id]
        ea.post_idx[j]    = ea.nid_to_idx[syn.post_neuron_id]
        ea.syn_size[j]    = syn.size
        ea.attenuation[j] = syn.attenuation
        ea.decay[j]       = exp(-DT / syn.tau_syn)
        ea.V_syn[j]       = syn.V_syn
        ea.c_i[j]         = syn.c_i
        ea.c_bar[j]       = syn.c_bar
        ea.sigma_stab[j]  = syn.sigma_stab
    end
end

# ══════════════════════════════════════════════════════════════════════════════
# Fast sync — called when topology is unchanged (common case, ~zero alloc)
# ══════════════════════════════════════════════════════════════════════════════

function sync_to_arrays!(ea::ElecArrays,
                         neuron_elec::Dict{String,NeuronElecState},
                         synapses::Dict{Int,SynapseRecord})
    @inbounds for i in 1:ea.n_neurons
        state = neuron_elec[ea.idx_to_nid[i]]
        ea.V[i]          = state.V
        ea.refractory[i] = state.refractory
        ea.fired[i]      = state.fired
        ea.fire_rate[i]  = state.fire_rate
        ea.fire_count[i] = 0   # reset for new substep block
        ea.seq_ptr[i]    = state.seq_ptr
    end
    @inbounds for j in 1:ea.n_synapses
        syn = synapses[ea.idx_to_sid[j]]
        ea.syn_size[j]    = syn.size
        ea.V_syn[j]       = syn.V_syn
        ea.c_i[j]         = syn.c_i
        ea.c_bar[j]       = syn.c_bar
        ea.sigma_stab[j]  = syn.sigma_stab
    end
end

function sync_from_arrays!(ea::ElecArrays,
                           neuron_elec::Dict{String,NeuronElecState},
                           synapses::Dict{Int,SynapseRecord})
    @inbounds for i in 1:ea.n_neurons
        state = neuron_elec[ea.idx_to_nid[i]]
        state.V          = ea.V[i]
        state.refractory = ea.refractory[i]
        state.fired      = ea.fired[i]
        state.fire_count = ea.fire_count[i]
        # EMA updated once per structural step from accurate count — converges in ~5 steps
        instantaneous    = ea.fire_count[i] / N_STRUCT
        state.fire_rate  = state.fire_rate * 0.8 + instantaneous * 0.2
        state.seq_ptr    = ea.seq_ptr[i]
        # Advance H ring buffer once with final fired state
        state.H[state.H_ptr] = ea.fired[i]
        state.H_ptr = mod1(state.H_ptr + 1, length(state.H))
    end
    @inbounds for j in 1:ea.n_synapses
        syn = synapses[ea.idx_to_sid[j]]
        syn.V_syn      = ea.V_syn[j]
        syn.c_i        = ea.c_i[j]
        syn.c_bar      = ea.c_bar[j]
        syn.sigma_stab = ea.sigma_stab[j]
    end
end

# ══════════════════════════════════════════════════════════════════════════════
# Vectorised electrical step functions
# ══════════════════════════════════════════════════════════════════════════════

function electrical_step_vec!(ea::ElecArrays, rng, t_elec::Int)
    fire_inputs_vec!(ea, rng)
    update_V_syns_vec!(ea)
    integrate_and_fire_vec!(ea)
    update_calcium_and_bcm_vec!(ea)
    # Fire rate is now computed from fire_count in sync_from_arrays!
end

# ── Input neurons ────────────────────────────────────────────────────────────

function fire_inputs_vec!(ea::ElecArrays, rng)
    @inbounds for i in 1:ea.n_neurons
        ea.is_input[i] && ea.is_active[i] || continue

        fired = if ea.input_mode[i] == :rate
            rand(rng) < ea.input_rate[i]
        elseif ea.input_mode[i] == :sequence && !isempty(ea.input_seq[i])
            seq = ea.input_seq[i]
            v   = seq[ea.seq_ptr[i]]
            ea.seq_ptr[i] = mod1(ea.seq_ptr[i] + 1, length(seq))
            v
        else
            false
        end
        ea.fired[i] = fired
        if fired; ea.fire_count[i] += 1; end
    end
end

# ── Synaptic integrators ────────────────────────────────────────────────────

function update_V_syns_vec!(ea::ElecArrays)
    S = ea.n_synapses
    @inbounds @simd for s in 1:S
        spike = Float64(ea.fired[ea.pre_idx[s]])
        ea.V_syn[s] = ea.V_syn[s] * ea.decay[s] +
                      spike * ea.syn_size[s] * ea.attenuation[s]
    end
end

# ── Integrate-and-fire ───────────────────────────────────────────────────────

function integrate_and_fire_vec!(ea::ElecArrays)
    N = ea.n_neurons
    S = ea.n_synapses

    # Phase 1: scatter-add V_syn contributions per post-neuron
    V_in = ea.V_input
    @inbounds for i in 1:N; V_in[i] = 0.0; end
    @inbounds for s in 1:S
        V_in[ea.post_idx[s]] += ea.V_syn[s]
    end

    # Phase 2: leaky integrate-and-fire
    @inbounds for i in 1:N
        ea.is_input[i] && continue
        ea.is_active[i] || continue

        if ea.refractory[i] > 0
            ea.refractory[i] -= 1
            ea.fired[i] = false
            continue
        end

        ea.V[i] = ea.V[i] * LEAK + V_in[i]

        if ea.V[i] >= THETA_FIRE
            ea.V[i]          = V_RESET
            ea.refractory[i] = REFRACTORY_STEPS
            ea.fired[i]      = true
            ea.fire_count[i] += 1
        else
            ea.fired[i] = false
        end
    end
end

# ── NMDA calcium proxy and BCM running averages ─────────────────────────────

function update_calcium_and_bcm_vec!(ea::ElecArrays)
    S   = ea.n_synapses
    lut = ea.nmda_lut
    α_ca   = 1.0 / W_CALCIUM
    α_stab = 1.0 / W_STABILITY

    @inbounds for s in 1:S
        x = (ea.V[ea.post_idx[s]] - THETA_NMDA) * 10.0
        nmda_gate = nmda_lut_lookup(lut, x)

        spike = Float64(ea.fired[ea.pre_idx[s]])
        c_i   = spike * ea.syn_size[s] * nmda_gate
        ea.c_i[s] = c_i

        ea.c_bar[s]      = ea.c_bar[s] * (1.0 - α_ca) + c_i * α_ca
        ea.sigma_stab[s] = ea.sigma_stab[s] * (1.0 - α_stab) + ea.c_bar[s] * α_stab
    end
end

# ── Firing rate EMA (every 10 ms) ────────────────────────────────────────────

function update_fire_rates_vec!(ea::ElecArrays, t_elec::Int)
    t_elec % 10 != 0 && return
    α = 1.0 / W_FIRE_RATE
    N = ea.n_neurons
    @inbounds @simd for i in 1:N
        ea.fire_rate[i] = ea.fire_rate[i] * (1.0 - α) + Float64(ea.fired[i]) * α
    end
end

# ══════════════════════════════════════════════════════════════════════════════
# Top-level entry point
# ══════════════════════════════════════════════════════════════════════════════

function electrical_substeps!(model, t_struct::Int)
    ea          = model.elec::ElecArrays
    neuron_elec = model.neuron_elec::Dict{String,NeuronElecState}
    synapses    = model.synapses::Dict{Int,SynapseRecord}
    rng         = model.rng

    if needs_rebuild(ea, neuron_elec, synapses)
        build_elec_arrays!(ea, model, neuron_elec, synapses)
    else
        sync_to_arrays!(ea, neuron_elec, synapses)
    end

    t_base = (t_struct - 1) * N_STRUCT
    for e in 1:N_STRUCT
        electrical_step_vec!(ea, rng, t_base + e)
    end

    sync_from_arrays!(ea, neuron_elec, synapses)
end

# ══════════════════════════════════════════════════════════════════════════════
# BCM size update — called once per structural step (stays scalar on Dicts)
# ══════════════════════════════════════════════════════════════════════════════

function apply_bcm_size_updates!(model)
    for (_, syn) in model.synapses
        nr = get(model.neurons, syn.post_neuron_id, nothing)
        nr === nothing && continue

        θ_ltd = nr.theta_ltd + nr.k_stab * syn.sigma_stab
        θ_ltp = nr.theta_ltp
        c̄     = syn.c_bar

        Δs_bcm = ETA_BCM * (c̄ - θ_ltd) * (θ_ltp - c̄) * c̄
        Δs_decay = -GAMMA_DECAY * syn.size^2

        syn.size = max(0.0, syn.size + Δs_bcm + Δs_decay)
    end
end

# ── Firing rate update (scalar fallback, unused in hot path) ─────────────────

function update_fire_rates!(model, t_elec::Int)
    if t_elec % 10 != 0; return; end
    α = 1.0 / W_FIRE_RATE
    for (nid, state) in model.neuron_elec
        state.fire_rate = state.fire_rate * (1 - α) + (state.fired ? 1.0 : 0.0) * α
    end
end

# ── Weight matrix export helper ──────────────────────────────────────────────

function compute_weight_matrix(model)
    id_set = Set{String}()
    for (_, syn) in model.synapses
        push!(id_set, syn.pre_neuron_id)
        push!(id_set, syn.post_neuron_id)
    end
    ids = sort(collect(id_set))
    N   = length(ids)
    idx = Dict(id => i for (i, id) in enumerate(ids))
    W   = zeros(Float64, N, N)

    for (_, syn) in model.synapses
        i = idx[syn.post_neuron_id]
        j = idx[syn.pre_neuron_id]
        W[i, j] += syn.size * syn.attenuation
    end
    return ids, W
end
