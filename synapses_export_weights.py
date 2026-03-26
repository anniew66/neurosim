"""
NeuroSim → PyTorch weight export
Usage:  python export_weights.py
Output: network_weights.pt
"""
import torch, pandas as pd, numpy as np
from collections import defaultdict

CSV_PATH = r"C:\Users\j15he\Documents\neurosim\synapses.csv"
LAMBDA_ELEC = 0.3   # mm — electrotonic length constant

df = pd.read_csv(CSV_PATH)

# Collect all neuron IDs
all_ids = sorted(set(df['pre_neuron_id']) | set(df['post_neuron_id']))
idx = {nid: i for i, nid in enumerate(all_ids)}
N = len(all_ids)

# Dense weight matrix: W[post, pre]
W = torch.zeros(N, N, dtype=torch.float64)
for _, row in df.iterrows():
    i = idx[row['post_neuron_id']]
    j = idx[row['pre_neuron_id']]
    # Effective weight = size * electrotonic attenuation
    W[i, j] += row['size_um2'] * np.exp(-row['distance_mm'] / LAMBDA_ELEC)

# Row-normalised version (each postsynaptic neuron sums to 1)
W_norm = W / W.sum(dim=1, keepdim=True).clamp(min=1e-8)

# Firing rates from most recent window (if available in CSV)
# If not, placeholder zeros
firing_rates = torch.zeros(N, dtype=torch.float64)

torch.save({
    'weights':            W,
    'weights_normalized': W_norm,
    'firing_rates':       firing_rates,
    'neuron_ids':         all_ids,
    'index_map':          idx,
    'n_neurons':          N,
}, 'network_weights.pt')

print(f'Saved network_weights.pt: {N}x{N} weight matrix')
print(f'Non-zero connections: {(W > 0).sum().item()}')
print(f'Max weight: {W.max().item():.4f}')
