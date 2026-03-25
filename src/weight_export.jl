# src/weight_export.jl
# Exports synapse data as CSV and generates a companion Python script
# that builds a PyTorch weight matrix from the CSV.

using CSV, DataFrames, Printf

# ── Synapse CSV ───────────────────────────────────────────────────────────────

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

# ── PyTorch export script ─────────────────────────────────────────────────────

function write_pytorch_script(synapse_csv_path::String, script_path::String)
    csv_abs = abspath(synapse_csv_path)
    lines   = String[]

    push!(lines, "\"\"\"")
    push!(lines, "NeuroSim → PyTorch weight export")
    push!(lines, "Usage:  python export_weights.py")
    push!(lines, "Output: network_weights.pt")
    push!(lines, "\"\"\"")
    push!(lines, "import torch, pandas as pd, numpy as np")
    push!(lines, "from collections import defaultdict")
    push!(lines, "")
    push!(lines, "CSV_PATH = r\"" * csv_abs * "\"")
    push!(lines, "LAMBDA_ELEC = 0.3   # mm — electrotonic length constant")
    push!(lines, "")
    push!(lines, "df = pd.read_csv(CSV_PATH)")
    push!(lines, "")
    push!(lines, "# Collect all neuron IDs")
    push!(lines, "all_ids = sorted(set(df['pre_neuron_id']) | set(df['post_neuron_id']))")
    push!(lines, "idx = {nid: i for i, nid in enumerate(all_ids)}")
    push!(lines, "N = len(all_ids)")
    push!(lines, "")
    push!(lines, "# Dense weight matrix: W[post, pre]")
    push!(lines, "W = torch.zeros(N, N, dtype=torch.float64)")
    push!(lines, "for _, row in df.iterrows():")
    push!(lines, "    i = idx[row['post_neuron_id']]")
    push!(lines, "    j = idx[row['pre_neuron_id']]")
    push!(lines, "    # Effective weight = size * electrotonic attenuation")
    push!(lines, "    W[i, j] += row['size_um2'] * np.exp(-row['distance_mm'] / LAMBDA_ELEC)")
    push!(lines, "")
    push!(lines, "# Row-normalised version (each postsynaptic neuron sums to 1)")
    push!(lines, "W_norm = W / W.sum(dim=1, keepdim=True).clamp(min=1e-8)")
    push!(lines, "")
    push!(lines, "# Firing rates from most recent window (if available in CSV)")
    push!(lines, "# If not, placeholder zeros")
    push!(lines, "firing_rates = torch.zeros(N, dtype=torch.float64)")
    push!(lines, "")
    push!(lines, "torch.save({")
    push!(lines, "    'weights':            W,")
    push!(lines, "    'weights_normalized': W_norm,")
    push!(lines, "    'firing_rates':       firing_rates,")
    push!(lines, "    'neuron_ids':         all_ids,")
    push!(lines, "    'index_map':          idx,")
    push!(lines, "    'n_neurons':          N,")
    push!(lines, "}, 'network_weights.pt')")
    push!(lines, "")
    push!(lines, "print(f'Saved network_weights.pt: {N}x{N} weight matrix')")
    push!(lines, "print(f'Non-zero connections: {(W > 0).sum().item()}')")
    push!(lines, "print(f'Max weight: {W.max().item():.4f}')")

    write(script_path, join(lines, "\n") * "\n")
    println("PyTorch script → $script_path")
end
