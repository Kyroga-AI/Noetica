# Graph Reinforcement Learning (GRL) Framework

> **Thesis.** Every capability in the estate — retrieval, reasoning routing, extraction, proposal
> ranking — should operate *over the graph* and *learn from users and the community* so it gets
> better with use. The graph is the environment; capabilities are actions; feedback is reward; and
> because the substrate is HellGraph, **every learning step is proof-carrying and auditable** — a moat
> no black-box RL system has.

This is **not** GRLPlus (that is the Goal-oriented Requirement Language / action-policy export engine —
symbolic governance, no learning). This is the learning loop.

## What already exists (verified, running in production)

Noetica already runs a **closed RL loop** — it just wasn't graph-native or federated:

| Piece | Where | Status |
|---|---|---|
| Context-free UCB1 bandit over model arms | `lib/capability-model.ts` `selectArmUCB`/`recordReward` | REAL-RUNNING (default-on) |
| Shaped multi-objective reward (worth − latency + grounding) | `lib/symbolic-policy.ts` `computeReward` | REAL-RUNNING |
| Reward signals: VJ worth, 👍/👎, grounding_status, graph accept/reject, Assay ok/sad/bad | value-judgment, grounding-signal, graph-proposals, noetica-events | REAL-RUNNING |
| Proof-carrying trajectory log (Run/Event/Receipt) | `lib/reasoning-evidence.ts` | REAL-RUNNING (every turn) |
| Gated experience store + teacher-student loop | `lib/procedural-memory.ts`, `lib/teacher-critique.ts` | REAL-RUNNING |
| PLN forward-chaining reasoner over the graph | `@socioprophet/hellgraph` `forwardChain` | REAL-RUNNING |
| Commons aggregation (HTTP, PII-gated) | `lib/commons-federation.ts` | REAL-RUNNING |

## The four gaps GRL closes

1. **State isn't the graph.** The bandit conditions on task features, not HellGraph structure.
2. **The graph-native policies are heuristic.** `intent-router`, `operation-router`, retrieval-source,
   proposal ranking = regex/rules — never learned.
3. **No numeric replay buffer.** Only curated verified experiences; no `(state, action, reward)` log
   for gradient/offline RL.
4. **Community learning is data-only.** The commons aggregates *search data*, not *rewards/policy*.

## The RL contract

- **State** `s` = the query's HellGraph neighbourhood, featurized (`lib/graph-state.ts`): epistemic
  mix (verified/observed/derived/hypothesis fractions on the shared ladder), subgraph size, edge
  density, PPR concentration, grounding flag, query specificity. Fixed-dim, normalized.
- **Action** `a` = a capability choice over the graph. Phase 1: retrieval grounding-source
  (`kb | vector-rag | web+vector | episodic | none`). Later: reasoning route, traversal depth,
  proposal accept threshold.
- **Reward** `r ∈ [0,1]` (`lib/grl-reward.ts`) = mined from signals Noetica already emits. Explicit
  human signal (accept/reject, 👍/👎) dominates; else blend grounding + Assay + VJ worth.
- **Policy** `π(s) → a` = **LinUCB** contextual bandit (`lib/grl-policy.ts`): per-arm `Aᵃ = I + Σxxᵀ`,
  `bᵃ = Σrx`, score `θᵀx + α√(xᵀA⁻¹x)`; `A⁻¹` maintained by Sherman–Morrison (no per-turn inversion).
- **Loop** (`lib/grl-loop.ts`): `decide → observe`. Persists learned weights + appends every transition
  to a numeric replay buffer (`~/.noetica/grl-transitions.jsonl`) — closing gap #3 and seeding Phase 3.
- **Proof-carrying**: each decision + reward emits an event; the transition log is append-only and
  hashable. Auditable RL.

## Roadmap (build order 1 → 2 → 3, per decision)

### Phase 1 — one policy, end-to-end (SHIPPED, shadow mode)
Retrieval grounding-source as a graph-state contextual bandit. Wired into the serving path
(`server.ts`, at the value-judgment reward site) in **shadow**: it decides + learns from every real
turn but does not yet override the heuristic. Observable at `GET /api/grl/standings`. Flip to active
with `NOETICA_GRL_RETRIEVAL` once standings prove out. **Local-first.** This is the template every
other policy copies.

### Phase 2 — multi-policy spine + community reward aggregation
- Generalize the template: a shared featurizer + policy interface across `intent-router`,
  `operation-router`, and graph-proposal ranking.
- Enrich the graph state with real neighbourhood analytics (PPR, degree, community — `graph-ppr.ts`,
  `graph-analytics.ts`) instead of the Phase-1 coarse grounding proxy.
- Mine the untapped rewards (graph accept/reject, Assay verdict).
- **Community learning (federated step 2):** aggregate gate-redacted `(state, action, reward)`
  transitions over the commons; a shared prior policy is distilled and shipped back, so the community
  gets better together while raw data stays local. Privacy-gated by the same floor as the open-chat
  commons.

### Phase 3 — GNN / tensor policy
- Finish the graph→tensor bridge (`prophet-platform-fabric-mlops-ts-suite/packs/shir-to-pyg`, today
  manifest-only) → real `edge_index`/feature tensors.
- Train a GNN policy over the graph on the Ray substrate (the declared `ray_rllib` standard),
  consuming the Phase-1/2 replay buffer offline, distilled back to a fast online policy.

## Advanced / strategically-important methods to expand into

Documented now so the roadmap is explicit (each is a deliberate follow-on, not vaporware):

- **Offline / batch RL** (CQL, IQL) over the replay buffer — learn from logged transitions without
  risky online exploration; the safe path to activate a policy before flipping it live.
- **Preference / RLHF over the graph** — learn from pairwise accept/reject of *paths* and *answers*,
  not just scalar reward; a reward model trained on the accept/reject log.
- **GNN policies** (GraphSAGE/GAT message-passing) — condition on multi-hop structure, not a
  hand-featurized ego-graph.
- **World-model / model-based RL** — HellGraph + PLN as a learned transition model to *plan* retrieval
  and reasoning rollouts before acting (Think-on-Graph as lookahead).
- **Federated policy learning** — per-user gradients aggregated with DP noise over the commons; the
  sovereign answer to "learn from the community" without centralizing data.
- **Multi-agent / cooperative GRL** — agent-team members as cooperating policies sharing the graph
  environment and a shared reward (ties into the swarm work).
- **Curriculum from the eval-replay flywheel** — mine `eval-cases.jsonl` failures into a training
  curriculum that hardens weak graph regions first.

## Invariants (do it well)

- **Fail-open**: the learning loop must never break a turn (all writes/emits are best-effort).
- **Proof-carrying**: every transition is logged + hashable; rewards trace to real signals, never
  invented (no signal → no update).
- **Shadow-before-active**: a new hot-path policy learns in shadow and is only flipped live once its
  replayed decisions beat the incumbent heuristic.
- **Sovereign + local-first**: learn on-device first; community aggregation is opt-in and gate-redacted.
- **Epistemic-aware**: state and reward weight verified knowledge above hypotheses (the shared ladder).
