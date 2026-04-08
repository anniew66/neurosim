# src/electrical.jl
# Electrical step functions: integrate-and-fire, synaptic integration,
# BCM/NMDA plasticity, synapse size dynamics.
# Runs N_STRUCT times per structural step at dt = 1 ms resolution.

using LinearAlgebra

# ── Top-level: run all electrical substeps ────────────────────────────────────

function electrical_substeps!(model, t_struct::Int)
    t_base = (t_struct - 1) * N_STRUCT
    for e in 1:N_STRUCT
        t_elec = t_base + e
        electrical_step!(model, t_elec)
    end
end

function electrical_step!(model, t_elec::Int)
    # 1. Determine input neuron firing
    fire_inputs!(model, t_elec)

    # 2. Update synaptic integrators (V_syn per synapse)
    update_V_syns!(model)

    # 3. Integrate soma potentials and check firing for non-input neurons
    integrate_and_fire!(model)

    # 4. Update calcium proxy and BCM synapse size (every step)
    update_calcium_and_bcm!(model, t_elec)

    # 5. Update activity-dependent chemical release strengths
    update_fire_rates!(model, t_elec)
end

# ── Input neurons ─────────────────────────────────────────────────────────────

function fire_inputs!(model, t_elec::Int)
    for (nid, state) in model.neuron_elec
        nr = get(model.neurons, nid, nothing)
        (nr === nothing || !nr.is_input) && continue
        soma_id = get(model.soma_agent_ids, nid, 0)
        soma_id == 0 && continue
        soma = model[soma_id]
        soma.dormant && continue

        spec = nr.input_spec
        fired = if spec.mode == :rate
            rand(model.rng) < spec.rate
        elseif spec.mode == :sequence && !isempty(spec.sequence)
            seq = spec.sequence
            v   = seq[state.seq_ptr]
            state.seq_ptr = mod1(state.seq_ptr + 1, length(seq))
            v
        else
            false
        end

        state.H[state.H_ptr] = fired
        state.H_ptr = mod1(state.H_ptr + 1, length(state.H))
        state.fired = fired
    end
end

# ── Synaptic integrators ──────────────────────────────────────────────────────

function update_V_syns!(model)
    for (_, syn) in model.synapses
        pre_state = get(model.neuron_elec, syn.pre_neuron_id, nothing)
        pre_state === nothing && continue

        pre_fired = pre_state.fired
        decay     = exp(-DT / syn.tau_syn)
        syn.V_syn = syn.V_syn * decay +
                    (pre_fired ? syn.size * syn.attenuation : 0.0)
    end
end

# ── Integrate-and-fire for non-input neurons ──────────────────────────────────

function integrate_and_fire!(model)
    # Accumulate V_syn contributions per post-neuron
    V_input = Dict{String,Float64}()
    for (_, syn) in model.synapses
        V_input[syn.post_neuron_id] = get(V_input, syn.post_neuron_id, 0.0) + syn.V_syn
    end

    for (nid, state) in model.neuron_elec
        nr = get(model.neurons, nid, nothing)
        (nr === nothing || nr.is_input) && continue
        soma_id = get(model.soma_agent_ids, nid, 0)
        soma_id == 0 && continue
        model[soma_id].dormant && continue

        if state.refractory > 0
            state.refractory -= 1
            state.fired = false
            state.H[state.H_ptr] = false
            state.H_ptr = mod1(state.H_ptr + 1, length(state.H))
            continue
        end

        # Leak + synaptic drive
        state.V = state.V * LEAK + get(V_input, nid, 0.0)

        fired = state.V >= THETA_FIRE
        if fired
            state.V          = V_RESET
            state.refractory = REFRACTORY_STEPS
        end

        state.fired      = fired
        state.H[state.H_ptr] = fired
        state.H_ptr = mod1(state.H_ptr + 1, length(state.H))
    end
end

# ── NMDA calcium proxy and BCM synapse size update ───────────────────────────

function update_calcium_and_bcm!(model, t_elec::Int)
    for (_, syn) in model.synapses
        pre_state  = get(model.neuron_elec, syn.pre_neuron_id, nothing)
        post_state = get(model.neuron_elec, syn.post_neuron_id, nothing)
        (pre_state === nothing || post_state === nothing) && continue

        # NMDA calcium: requires both pre firing AND post depolarization
        nmda_gate = 1.0 / (1.0 + exp(-(post_state.V - THETA_NMDA) * 10.0))
        c_i       = (pre_state.fired ? syn.size * nmda_gate : 0.0)
        syn.c_i   = c_i

        # Running averages
        α_ca    = 1.0 / W_CALCIUM
        α_stab  = 1.0 / W_STABILITY
        syn.c_bar      = syn.c_bar * (1 - α_ca) + c_i * α_ca
        syn.sigma_stab = syn.sigma_stab * (1 - α_stab) + syn.c_bar * α_stab

        # BCM update — once per structural step (batch accumulate)
        # Size update is applied in structural step to avoid per-ms allocation
        # Here we just maintain the electrical-timescale running averages.
    end
end

# Apply BCM size update — called once per structural step
function apply_bcm_size_updates!(model)
    for (_, syn) in model.synapses
        nr = get(model.neurons, syn.post_neuron_id, nothing)
        nr === nothing && continue

        # Sliding LTD threshold: stable synapses harder to depotentiate
        θ_ltd = nr.theta_ltd + nr.k_stab * syn.sigma_stab
        θ_ltp = nr.theta_ltp
        c̄     = syn.c_bar

        # BCM cubic rule: Δs = η * (c̄ - θ_ltd) * (θ_ltp - c̄)
        # Negative below θ_ltd (LTD), positive between thresholds (LTP),
        # negative above θ_ltp (prevents runaway at very high calcium).
        Δs_bcm = ETA_BCM * (c̄ - θ_ltd) * (θ_ltp - c̄) * c̄

        # Metabolic decay: cost scales with s² (larger synapses more expensive)
        Δs_decay = -GAMMA_DECAY * syn.size

        syn.size = max(0.0, syn.size + Δs_bcm + Δs_decay)
    end
end

# ── Firing rate update (used for activity-dependent chem release) ─────────────

function update_fire_rates!(model, t_elec::Int)
    if t_elec % 10 != 0; return; end  # update every 10 ms to save cost
    α = 1.0 / W_FIRE_RATE
    for (nid, state) in model.neuron_elec
        state.fire_rate = state.fire_rate * (1 - α) + (state.fired ? 1.0 : 0.0) * α
    end
end

# ── Weight matrix export helper ───────────────────────────────────────────────
# Returns (neuron_ids, W) where W[i,j] = effective connection weight from j→i.
function compute_weight_matrix(model)
    # Collect all neuron IDs that appear in at least one synapse
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
