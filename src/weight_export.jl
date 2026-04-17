# src/weight_export.jl
# Exports the grown network as:
#   1. synapses.csv   — one row per synapse (edges + edge features)
#   2. neurons.csv    — one row per neuron  (node features)
#   3. a Python script that assembles these into a PyTorch Geometric-style
#      graph (edge_index, edge_weight, edge_attr, x) saved as network_graph.pt.
#      A dense N×N weight matrix is also written for spectral analysis.

using CSV, DataFrames, Printf

# ── Synapse CSV (edges) ───────────────────────────────────────────────────────

function export_synapse_csv(model, path::String)
    rows = NamedTuple{
        (:synapse_id,:pre_neuron_id,:post_neuron_id,:pre_gc_id,:post_gc_id,
         :is_axosomatic,:size_um2,:distance_mm,:attenuation,:effective_weight,
         :c_bar,:sigma_stab,:pre_morphology,:post_morphology),
        Tuple{Int,String,String,Int,Int,Bool,Float64,Float64,Float64,Float64,
              Float64,Float64,String,String}
    }[]

    for (sid, syn) in model.synapses
        pre_morph  = get(model.neurons, syn.pre_neuron_id,  nothing)
        post_morph = get(model.neurons, syn.post_neuron_id, nothing)
        push!(rows, (
            synapse_id     = sid,
            pre_neuron_id  = syn.pre_neuron_id,
            post_neuron_id = syn.post_neuron_id,
            pre_gc_id      = syn.pre_gc_id,
            post_gc_id     = syn.post_gc_id,
            is_axosomatic  = syn.is_axosomatic,
            size_um2       = syn.size,
            distance_mm    = syn.distance,
            attenuation    = syn.attenuation,
            effective_weight = syn.size * syn.attenuation,
            c_bar          = syn.c_bar,
            sigma_stab     = syn.sigma_stab,
            pre_morphology = pre_morph  !== nothing ? pre_morph.morphology  : "unknown",
            post_morphology= post_morph !== nothing ? post_morph.morphology : "unknown",
        ))
    end

    df = DataFrame(rows)
    CSV.write(path, df)
    println("Synapse CSV → $path ($(nrow(df)) synapses)")
    return path
end

# ── Neuron CSV (nodes) ────────────────────────────────────────────────────────
# Per-neuron features consumed as GNN node features `x`. Soma-derived fields
# (health, soma_radius, n_stable_syn) are pulled from live Soma agents; missing
# somas (pre-activation / dead) default to neutral values.

function export_neuron_csv(model, path::String)
    soma_state = Dict{String,NamedTuple{(:health,:soma_radius,:n_stable_syn),
                                        Tuple{Float64,Float64,Int}}}()
    for a in allagents(model)
        if a isa Soma
            soma_state[a.neuron_id] = (
                health       = a.health,
                soma_radius  = a.soma_radius,
                n_stable_syn = a.n_stable_syn,
            )
        end
    end

    rows = NamedTuple{
        (:neuron_id,:morphology,:is_input,:firing_rate,
         :theta_ltp,:theta_ltd,:k_stab,
         :health,:soma_radius,:n_stable_syn,
         :soma_x,:soma_y,:soma_z),
        Tuple{String,String,Bool,Float64,
              Float64,Float64,Float64,
              Float64,Float64,Int,
              Float64,Float64,Float64}
    }[]

    for (nid, nr) in model.neurons
        elec  = get(model.neuron_elec, nid, nothing)
        rate  = elec !== nothing ? elec.fire_rate : 0.0
        sstat = get(soma_state, nid, (health=1.0, soma_radius=nr.soma_radius_base,
                                      n_stable_syn=0))
        push!(rows, (
            neuron_id    = nid,
            morphology   = nr.morphology,
            is_input     = nr.is_input,
            firing_rate  = rate,
            theta_ltp    = nr.theta_ltp,
            theta_ltd    = nr.theta_ltd,
            k_stab       = nr.k_stab,
            health       = sstat.health,
            soma_radius  = sstat.soma_radius,
            n_stable_syn = sstat.n_stable_syn,
            soma_x       = nr.soma_pos[1],
            soma_y       = nr.soma_pos[2],
            soma_z       = nr.soma_pos[3],
        ))
    end

    df = DataFrame(rows)
    CSV.write(path, df)
    println("Neuron CSV → $path ($(nrow(df)) neurons)")
    return path
end

# ── PyTorch Geometric export script ───────────────────────────────────────────
# Produces network_graph.pt: a dict of tensors compatible with
# torch_geometric.data.Data(**torch.load(...)). torch_geometric is NOT required
# to generate the file — only to wrap it at training time.

function write_pytorch_script(synapse_csv_path::String,
                              neuron_csv_path::String,
                              script_path::String)
    syn_abs    = abspath(synapse_csv_path)
    neuron_abs = abspath(neuron_csv_path)
    lines      = String[]

    push!(lines, "\"\"\"")
    push!(lines, "NeuroSim → PyTorch Geometric export")
    push!(lines, "")
    push!(lines, "Usage:  python synapses_export_weights.py")
    push!(lines, "Output: network_graph.pt   — sparse graph (edge_index, edge_weight, edge_attr, x)")
    push!(lines, "        network_weights.pt — dense N×N matrix (for spectral analysis)")
    push!(lines, "")
    push!(lines, "Load at training time:")
    push!(lines, "    import torch")
    push!(lines, "    from torch_geometric.data import Data")
    push!(lines, "    data = Data(**torch.load('network_graph.pt'))")
    push!(lines, "\"\"\"")
    push!(lines, "import torch, pandas as pd, numpy as np")
    push!(lines, "")
    push!(lines, "SYN_CSV    = r\"" * syn_abs * "\"")
    push!(lines, "NEURON_CSV = r\"" * neuron_abs * "\"")
    push!(lines, "")
    push!(lines, "syn = pd.read_csv(SYN_CSV)")
    push!(lines, "nod = pd.read_csv(NEURON_CSV)")
    push!(lines, "")
    push!(lines, "# ── Node indexing ────────────────────────────────────────────────")
    push!(lines, "# Union of neurons referenced by CSVs — covers isolated nodes and")
    push!(lines, "# any stray IDs in the synapse table.")
    push!(lines, "all_ids = sorted(set(nod['neuron_id'])")
    push!(lines, "                 | set(syn['pre_neuron_id']) | set(syn['post_neuron_id']))")
    push!(lines, "idx = {nid: i for i, nid in enumerate(all_ids)}")
    push!(lines, "N = len(all_ids)")
    push!(lines, "")
    push!(lines, "# ── Edge tensors ─────────────────────────────────────────────────")
    push!(lines, "# Convention: edges point pre → post, so edge_index[0] = source (pre),")
    push!(lines, "# edge_index[1] = target (post). PyG's MessagePassing aggregates")
    push!(lines, "# messages at the target, i.e. the postsynaptic neuron.")
    push!(lines, "pre_idx  = syn['pre_neuron_id'].map(idx).to_numpy()")
    push!(lines, "post_idx = syn['post_neuron_id'].map(idx).to_numpy()")
    push!(lines, "edge_index = torch.tensor(np.stack([pre_idx, post_idx]), dtype=torch.long)")
    push!(lines, "")
    push!(lines, "edge_weight = torch.tensor(syn['effective_weight'].to_numpy(),")
    push!(lines, "                           dtype=torch.float32)")
    push!(lines, "edge_attr   = torch.tensor(syn[['size_um2','distance_mm','attenuation',")
    push!(lines, "                                'c_bar','sigma_stab']].to_numpy(),")
    push!(lines, "                           dtype=torch.float32)")
    push!(lines, "edge_attr_names = ['size_um2','distance_mm','attenuation','c_bar','sigma_stab']")
    push!(lines, "")
    push!(lines, "# ── Node feature matrix x ────────────────────────────────────────")
    push!(lines, "nod = nod.set_index('neuron_id').reindex(all_ids).reset_index()")
    push!(lines, "morph_codes, morph_categories = pd.factorize(nod['morphology'].fillna('unknown'))")
    push!(lines, "x = torch.tensor(np.stack([")
    push!(lines, "    morph_codes.astype(np.float32),")
    push!(lines, "    nod['is_input'].fillna(False).astype(np.float32).to_numpy(),")
    push!(lines, "    nod['firing_rate'].fillna(0.0).to_numpy(dtype=np.float32),")
    push!(lines, "    nod['theta_ltp'].fillna(0.0).to_numpy(dtype=np.float32),")
    push!(lines, "    nod['theta_ltd'].fillna(0.0).to_numpy(dtype=np.float32),")
    push!(lines, "    nod['k_stab'].fillna(0.0).to_numpy(dtype=np.float32),")
    push!(lines, "    nod['health'].fillna(1.0).to_numpy(dtype=np.float32),")
    push!(lines, "    nod['soma_radius'].fillna(0.0).to_numpy(dtype=np.float32),")
    push!(lines, "    nod['n_stable_syn'].fillna(0).to_numpy(dtype=np.float32),")
    push!(lines, "], axis=1), dtype=torch.float32)")
    push!(lines, "x_names = ['morphology_code','is_input','firing_rate',")
    push!(lines, "           'theta_ltp','theta_ltd','k_stab',")
    push!(lines, "           'health','soma_radius','n_stable_syn']")
    push!(lines, "")
    push!(lines, "# ── Save sparse graph (primary output) ───────────────────────────")
    push!(lines, "torch.save({")
    push!(lines, "    'edge_index':       edge_index,")
    push!(lines, "    'edge_weight':      edge_weight,")
    push!(lines, "    'edge_attr':        edge_attr,")
    push!(lines, "    'edge_attr_names':  edge_attr_names,")
    push!(lines, "    'x':                x,")
    push!(lines, "    'x_names':          x_names,")
    push!(lines, "    'num_nodes':        N,")
    push!(lines, "    'neuron_ids':       all_ids,")
    push!(lines, "    'morphology_categories': list(morph_categories),")
    push!(lines, "}, 'network_graph.pt')")
    push!(lines, "print(f'Saved network_graph.pt: N={N} nodes, E={edge_index.shape[1]} edges, ',")
    push!(lines, "      f'density={edge_index.shape[1] / max(N*N, 1):.2e}')")
    push!(lines, "")
    push!(lines, "# ── Save dense weight matrix (secondary, for spectral analysis) ──")
    push!(lines, "W = torch.zeros(N, N, dtype=torch.float32)")
    push!(lines, "W.index_put_((torch.tensor(post_idx), torch.tensor(pre_idx)),")
    push!(lines, "             edge_weight, accumulate=True)")
    push!(lines, "row_sum = W.sum(dim=1, keepdim=True).clamp(min=1e-8)")
    push!(lines, "torch.save({")
    push!(lines, "    'weights':            W,")
    push!(lines, "    'weights_normalized': W / row_sum,")
    push!(lines, "    'neuron_ids':         all_ids,")
    push!(lines, "    'index_map':          idx,")
    push!(lines, "    'n_neurons':          N,")
    push!(lines, "}, 'network_weights.pt')")
    push!(lines, "print(f'Saved network_weights.pt: {N}x{N} dense matrix, ',")
    push!(lines, "      f'max={W.max().item():.4f}')")

    write(script_path, join(lines, "\n") * "\n")
    println("PyTorch script → $script_path")
end
