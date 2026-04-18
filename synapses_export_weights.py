"""
NeuroSim → PyTorch Geometric export

Usage:  python synapses_export_weights.py
Output: network_graph.pt   — sparse graph (edge_index, edge_weight, edge_attr, x)
        network_weights.pt — dense N×N matrix (for spectral analysis)

Load at training time:
    import torch
    from torch_geometric.data import Data
    data = Data(**torch.load('network_graph.pt'))
"""
import torch, pandas as pd, numpy as np

SYN_CSV    = r"C:\Users\j15he\Documents\neurosim\synapses.csv"
NEURON_CSV = r"C:\Users\j15he\Documents\neurosim\neurons.csv"

syn = pd.read_csv(SYN_CSV)
nod = pd.read_csv(NEURON_CSV)

# ── Node indexing ────────────────────────────────────────────────
# Union of neurons referenced by CSVs — covers isolated nodes and
# any stray IDs in the synapse table.
all_ids = sorted(set(nod['neuron_id'])
                 | set(syn['pre_neuron_id']) | set(syn['post_neuron_id']))
idx = {nid: i for i, nid in enumerate(all_ids)}
N = len(all_ids)

# ── Edge tensors ─────────────────────────────────────────────────
# Convention: edges point pre → post, so edge_index[0] = source (pre),
# edge_index[1] = target (post). PyG's MessagePassing aggregates
# messages at the target, i.e. the postsynaptic neuron.
pre_idx  = syn['pre_neuron_id'].map(idx).to_numpy()
post_idx = syn['post_neuron_id'].map(idx).to_numpy()
edge_index = torch.tensor(np.stack([pre_idx, post_idx]), dtype=torch.long)

edge_weight = torch.tensor(syn['effective_weight'].to_numpy(),
                           dtype=torch.float32)
edge_attr   = torch.tensor(syn[['size_um2','distance_mm','attenuation',
                                'c_bar','sigma_stab']].to_numpy(),
                           dtype=torch.float32)
edge_attr_names = ['size_um2','distance_mm','attenuation','c_bar','sigma_stab']

# ── Node feature matrix x ────────────────────────────────────────
nod = nod.set_index('neuron_id').reindex(all_ids).reset_index()
morph_codes, morph_categories = pd.factorize(nod['morphology'].fillna('unknown'))
x = torch.tensor(np.stack([
    morph_codes.astype(np.float32),
    nod['is_input'].fillna(False).astype(np.float32).to_numpy(),
    nod['firing_rate'].fillna(0.0).to_numpy(dtype=np.float32),
    nod['theta_ltp'].fillna(0.0).to_numpy(dtype=np.float32),
    nod['theta_ltd'].fillna(0.0).to_numpy(dtype=np.float32),
    nod['k_stab'].fillna(0.0).to_numpy(dtype=np.float32),
    nod['health'].fillna(1.0).to_numpy(dtype=np.float32),
    nod['soma_radius'].fillna(0.0).to_numpy(dtype=np.float32),
    nod['n_stable_syn'].fillna(0).to_numpy(dtype=np.float32),
], axis=1), dtype=torch.float32)
x_names = ['morphology_code','is_input','firing_rate',
           'theta_ltp','theta_ltd','k_stab',
           'health','soma_radius','n_stable_syn']

# ── Save sparse graph (primary output) ───────────────────────────
torch.save({
    'edge_index':       edge_index,
    'edge_weight':      edge_weight,
    'edge_attr':        edge_attr,
    'edge_attr_names':  edge_attr_names,
    'x':                x,
    'x_names':          x_names,
    'num_nodes':        N,
    'neuron_ids':       all_ids,
    'morphology_categories': list(morph_categories),
}, 'network_graph.pt')
E = edge_index.shape[1]
n_pairs = len(set(zip(pre_idx.tolist(), post_idx.tolist())))
print(f'Saved network_graph.pt: N={N} nodes, E={E} edges ',
      f'({n_pairs} unique pairs, avg {E/max(n_pairs,1):.1f} multi-edges/pair)')

# ── Save dense weight matrix (secondary, for spectral analysis) ──
W = torch.zeros(N, N, dtype=torch.float32)
W.index_put_((torch.tensor(post_idx), torch.tensor(pre_idx)),
             edge_weight, accumulate=True)
row_sum = W.sum(dim=1, keepdim=True).clamp(min=1e-8)
torch.save({
    'weights':            W,
    'weights_normalized': W / row_sum,
    'neuron_ids':         all_ids,
    'index_map':          idx,
    'n_neurons':          N,
}, 'network_weights.pt')
print(f'Saved network_weights.pt: {N}x{N} dense matrix, ',
      f'max={W.max().item():.4f}')
