# Edge ↔ Managed HellGraph — distributed coordination & sync (CAP-engineered)

Status: design (engineering spec filling in `prophet-platform/docs/LOCAL_FIRST_PLATFORM_BINDING.md`'s SHOULDs).
Scope: how the sovereign **edge** graph (noetica, embedded HellGraph) and the **managed** graph
(`hellgraph-service`, the platform's authoritative store) coordinate, sync, and converge — as a proper
distributed system with deliberately-chosen CAP/PACELC tradeoffs, not ad-hoc push/pull.

## 0. The governing constraint (why the CAP choice is forced)

Sovereignty is the moat: the edge MUST function **fully offline** (air-gapped, zero egress). That is a hard
requirement, not a preference — so a partition between edge and service is the *common* case, not an exception.
This forces the top-level choice.

## 1. CAP / PACELC — engineered, not defaulted

- **CAP → AP.** Under partition (edge offline) the edge stays **Available + Partition-tolerant**; it never blocks
  on the service. Choosing CP (block until consistent) would break sovereignty + offline, so AP is forced *and*
  correct. The managed service is also AP for serving reads.
- **Strongest model achievable under AP → causal+ consistency** (the theoretical ceiling for always-available
  systems — COPS/causal+). Default is **causal consistency**, NOT "eventual/last-writer-wins chaos."
- **PACELC → PA / EL**, with per-class opt-in to consistency. Partition → Availability. Else (online) → default
  Low-latency (serve locally + reconcile async); governed writes may opt into Consistency (an admission
  round-trip) when the use case demands it.

## 2. The key move: per-data-class consistency (mixed-consistency, not one CAP point)

Do NOT pick one CAP point for the whole graph. Classify graph data; engineer the tradeoff per class:

| Class | Authority | Sync | Consistency | Conflict policy |
|-------|-----------|------|-------------|-----------------|
| **Edge-private** (user docs/graph) | edge | never (unless shared) | n/a (single writer) | none |
| **Derived** (GDS / GraphRAG / glossary) | recomputed | inputs only, never results | follows inputs | recompute (no conflict possible) |
| **Shared-collaborative** (multi-edge co-edit) | shared | bidirectional | causal+ via CRDT | CRDT auto-merge |
| **Governed/authoritative** (ontology, policy, canonical entities) | **platform** | edge caches read-replica; edge writes = proposals | read-your-writes when online; provisional offline | admission arbitration (platform wins) |

The wins: most data is edge-private (zero coordination — sovereignty default); **derived state is never synced**
(it's a pure function of basis+revision — eliminates a whole conflict class, and ties directly to the
refresh-framework's `basis_fingerprint`); only genuinely-shared data pays sync cost; governed truth keeps a single
authority without blocking the edge.

## 3. The sync protocol (over existing primitives — almost nothing is new substrate)

| Need | Existing primitive | Role in sync |
|------|--------------------|--------------|
| Logical clock | `hg_kernel::TxnId` (per-replica, monotonic) | per-replica version; compose into **version vectors** (edge_id→txn) for causality |
| Replicated op-log | the journal/WAL + `JournalManifest{last_replayed_txn,last_frame_seq}` | the WAL *is* the op-log; manifest cursors are replication watermarks — ship deltas since the peer's last-acked txn (**log shipping**) |
| Idempotent ordered transport | TriTRPC frame `idempotency_key` + `replay_nonce` + `sequence` | exactly-once *effect*, replay-safe, ordered delivery |
| Delta merge | `hg_runtime::apply_events(prior, events)` | fold shipped deltas into prior state |
| Convergence | CRDT op semantics over the ops | OR-Set for node/edge add/remove; LWW- or MV-register for properties keyed by the version vector → order-independent |
| **Anti-entropy** | `fnv1a64` subgraph fingerprints | **Merkle tree of subgraph fingerprints**: compare subtree fingerprints top-down, ship ONLY divergent subtrees (Dynamo/Cassandra-style). Cheap convergence, no full-graph transfer |
| Provenance-through-sync | `hg_proof` `basis_version` + fingerprints + signatures | every synced fact carries its basis + signature → the tamper-evident audit chain **extends across the edge↔service boundary** (a real differentiator) |
| Governed write path | scope-d admission + action-plane + zone-router outbox | edge write → local provisional commit + proposal queued → platform admission → canonical + receipt back (reject → reconcile) |

**Write path (per LOCAL_FIRST_PLATFORM_BINDING, made concrete):** local mutation → durable edge commit (new TxnId)
→ emit receipt → enqueue governed replication (outbox) → ship delta on TriTRPC when online → peer applies via
apply_events → ack updates the manifest cursor → publish replication/divergence outcome. **No interactive workflow
waits on a central round-trip** when local policy permits the write.

## 4. Failure modes (engineered)

- **Partition (offline):** edge fully functional (AP); pending ops accumulate in the zone-router outbox
  (dead-letter + retry/backoff already exist).
- **Reconnect / anti-entropy:** exchange version vectors → ship deltas both ways → **Merkle fingerprint diff** to
  find divergent subgraphs without shipping everything → apply_events → per-class conflict resolution.
- **Conflict resolution by class:** derived → recompute; private → no sync; collaborative → CRDT auto-converge;
  governed → admission arbitration (platform wins; the edge write was a *proposal*), with genuine semantic
  conflicts surfaced to a steward via the Govern surface (that's the point of the governance lane).
- **Repair/replay:** divergence outcomes are replayable via the CairnPath spine (Context/Step/Line/Result) →
  repair scheduling (the binding's repair surface).
- **Bounded staleness:** each class carries a staleness budget; online, a background loop keeps governed reads
  fresh within bound; the user sees provenance (last-synced txn + staleness + provisional/admitted state) — reuses
  the answer-provenance badges.

## 5. What exists vs what's new

**Exists (substrate):** TxnId, journal + manifest cursors, apply_events, snapshot-at-txn reads, fnv1a64
fingerprints, hg_proof, TriTRPC (idempotency/replay), zone-router outbox/dead-letter, scope-d + action-plane
admission, the LOCAL_FIRST_PLATFORM_BINDING skeleton, CairnPath replay.

**New (to build):** the version-vector layer over TxnId; the per-class classification + policy table (§2); CRDT op
semantics on graph ops (OR-Set / LWW-MV); the **Merkle-fingerprint anti-entropy** walk; the **sync control
surface** (the binding names it a SHOULD — implement it: queue/track/diverge/repair/replay); and
provenance-through-sync (carry hg_proof across the boundary).

## 6. Decisions — LOCKED 2026-06-27

1. **CRDT flavor (collaborative class): OP-BASED.** Ship ops over TriTRPC (causal + idempotent delivery); the
   journal/op-log is the source. Semantics: **add-wins OR-Set** for nodes/edges, **LWW-register** for properties
   (tie-break by `(lamport, replicaId)`). Implemented in `agent-machine/lib/sync-engine.ts`.
2. **Governed-write UX: OPTIMISTIC-PROVISIONAL.** Edge commits locally + shows the write immediately, tagged
   provisional; reconciles on platform admit (→ canonical) or reject (→ rollback + steward surface). Explicit
   provenance state shown to the user (provisional / admitted / rejected).
3. **Conflict surfacing: AUTO for private/derived/collaborative; STEWARD for governed.** CRDT auto-converges the
   first three; genuine governed/semantic conflicts surface to a steward via the Govern surface.
4. **Spec home: PROMOTE** to `prophet-platform/docs` alongside LOCAL_FIRST_PLATFORM_BINDING.

## 7. Phasing

- **S0:** version-vector + manifest-cursor sync of the **derived-inputs-only** path (lowest risk — derived never
  conflicts) + provenance-carrying frames. Proves the transport + cursors end-to-end.
- **S1:** governed read-replica + optimistic governed writes via action-plane admission (the highest-value
  enterprise path; reuses scope-d).
- **S2:** Merkle-fingerprint anti-entropy + CRDT collaborative class (multi-edge co-edit).
- **S3:** repair/replay over CairnPath + bounded-staleness UX + steward conflict surfacing.

Gated by the engine work: this rides the Rust `hg_kernel` (TxnId/journal/apply_events) — so it lands after the edge
binds to the Rust kernel (local sidecar, like noetica-embed). Until then, S0 can prototype over the TS AtomSpace
using the refresh-framework's revision+fingerprint as the stand-in clock.
