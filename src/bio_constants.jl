# src/bio_constants.jl
# Biological constants and per-morphology parameters.
# All spatial values in mm, time in ms.
# dt = 1 ms per electrical step (resolvable for spike timing).
# N_STRUCT = 100 electrical steps per structural step (100 ms of simulated time).

# ── Time and step constants ───────────────────────────────────────────────────
const DT                = 1.0      # ms — one electrical step
const N_STRUCT          = 100      # electrical steps per structural step

# ── Membrane biophysics ───────────────────────────────────────────────────────
const TAU_MEM           = 15.0     # ms — membrane time constant (RC circuit)
const LEAK              = exp(-DT / TAU_MEM)   # ≈ 0.935 per step
const THETA_FIRE        = 1.0      # normalised firing threshold
const V_RESET           = 0.0     # potential after spike
const THETA_NMDA        = 0.5     # NMDA Mg²⁺ relief half-voltage
const REFRACTORY_STEPS  = 3       # steps — absolute refractory period (~3 ms)

# ── Synaptic biophysics ───────────────────────────────────────────────────────
const TAU_SYN_BASE      = 5.0     # ms — synaptic time constant at soma
const LAMBDA_ELEC       = 0.3     # mm — electrotonic length constant
const LAMBDA_DISP       = 0.1     # mm — temporal dispersion constant

# ── Plasticity windows ────────────────────────────────────────────────────────
const W_STDP_PRE        = 20      # steps — pre→post window (LTP)
const W_STDP_POST       = 30      # steps — post→pre window (LTD)
const W_CALCIUM         = 100     # steps — calcium averaging window (100 ms)
const W_STABILITY       = 10_000  # steps — slow stability average (10 s sim)
const W_FIRE_RATE       = 500     # steps — recent firing rate estimate

# ── BCM plasticity ────────────────────────────────────────────────────────────
const ETA_BCM           = 0.0005  # learning rate (structural step scale)
const GAMMA_DECAY       = 0.0008  # metabolic decay coefficient for s²

# ── Synapse size ──────────────────────────────────────────────────────────────
const S_INIT            = 0.05    # µm² — initial provisional synapse size
const S_MIN_VIABLE      = 0.005   # µm² — below this counts as weak

# ── Pruning ───────────────────────────────────────────────────────────────────
# Biological pruning (complement tagging) takes ~1–3 days.
# Compressed: 5000 structural steps = 500 s sim ≈ adjustable by user.
const PRUNE_DELAY_DEFAULT = 5_000  # structural steps of weakness before removal

# ── Branch retraction ─────────────────────────────────────────────────────────
const RETRACT_ALPHA     = 6.0     # sigmoid sharpness
const L_EQ_BASE         = 0.02    # mm — equilibrium length with 0 synapses
const L_EQ_PER_SYN      = 0.12   # mm bonus per stable-ish synapse on branch
const P_PAUSE_BASE      = 0.05   # base probability of growth cone pausing each structural step

# ── Activity-dependent chemical release ───────────────────────────────────────
const ACTIVITY_SCALE    = 2.0     # multiplier on fire_rate for release strength
const CHEM_SIGMA_BASE   = 0.2     # mm — default diffusion sigma

# ── Tissue density effects ────────────────────────────────────────────────────
const K_TORTUOSITY      = 1.5     # random walk boost per unit density
const K_COMPRESS        = 0.4     # sigma reduction per unit density
const K_NOISE           = 0.8     # gradient noise per unit density
const K_PAUSE           = 0.15   # pause probability boost per unit density

# ── Per-morphology BCM thresholds ────────────────────────────────────────────
# theta_ltd:  calcium level below which LTD occurs (depotentiation)
# theta_ltp:  calcium level above which net LTP occurs
# k_stab:     how much stability score raises the LTD threshold
# Purkinje: biased toward LTD — parallel fiber→Purkinje LTD is canonical
const BCM_PARAMS = Dict(
    "purkinje"  => (theta_ltd=0.15f0, theta_ltp=0.35f0, k_stab=0.08f0),
    "granule"   => (theta_ltd=0.10f0, theta_ltp=0.55f0, k_stab=0.05f0),
    "basket"    => (theta_ltd=0.12f0, theta_ltp=0.50f0, k_stab=0.06f0),
    "stellate"  => (theta_ltd=0.12f0, theta_ltp=0.50f0, k_stab=0.06f0),
    "golgi"     => (theta_ltd=0.10f0, theta_ltp=0.52f0, k_stab=0.05f0),
    "generic"   => (theta_ltd=0.10f0, theta_ltp=0.55f0, k_stab=0.05f0),
)

function bcm_params(morphology::String)
    get(BCM_PARAMS, lowercase(morphology), BCM_PARAMS["generic"])
end

# ── Morphology structural defaults ───────────────────────────────────────────
const MORPHOLOGY_DEFAULTS = Dict(
    "purkinje"  => (branch_prob=0.04, L_target=3.0,
                    soma_radius=0.032, soma_radius_noise=0.006,
                    releases=["BDNF"], attracts=["NT3"], repels=["Sema3A"]),
    "granule"   => (branch_prob=0.01, L_target=4.5,
                    soma_radius=0.0035, soma_radius_noise=0.0005,
                    releases=["NT3"], attracts=["BDNF"], repels=[]),
    "basket"    => (branch_prob=0.02, L_target=0.7,
                    soma_radius=0.009, soma_radius_noise=0.001,
                    releases=["GABA"], attracts=["BDNF"], repels=["Sema3A"]),
    "stellate"  => (branch_prob=0.02, L_target=0.35,
                    soma_radius=0.006, soma_radius_noise=0.0015,
                    releases=["GABA"], attracts=["BDNF"], repels=[]),
    "golgi"     => (branch_prob=0.02, L_target=0.8,
                    soma_radius=0.015, soma_radius_noise=0.003,
                    releases=["GABA"], attracts=["NT3"], repels=[]),
    "generic"   => (branch_prob=0.02, L_target=2.0,
                    soma_radius=0.010, soma_radius_noise=0.002,
                    releases=[], attracts=[], repels=[]),
)

function morphology_defaults(morphology::String)
    get(MORPHOLOGY_DEFAULTS, lowercase(morphology), MORPHOLOGY_DEFAULTS["generic"])
end

# ── Retraction probability ────────────────────────────────────────────────────
function p_retract(branch_len::Float64, n_branch_synapses::Int)::Float64
    L_eq = L_EQ_BASE + L_EQ_PER_SYN * n_branch_synapses
    1.0 / (1.0 + exp(-RETRACT_ALPHA * (branch_len - L_eq) / max(L_eq, 1e-6)))
end
