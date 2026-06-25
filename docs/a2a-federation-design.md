# A2A federation: interop with Ruflo / gastown / AIWG on the zero-trust foundation

**Status:** draft / design — 2026-06-25
**Owner:** Michael
**Premise:** Noetica is a *peer* agent-harness ("Agent = Model + Harness"), not a consumer of one. So we don't adopt Ruflo — we **interoperate** with it (and gastown, AIWG) as a **sovereign zero-trust node**, on the A2A + MCP foundation we already have (`lib/a2a/grantCheck.ts` + `lib/mcp/*`). scope-d stays the purple-team egress gate — **composed, never merged.**

---

## 1. The foundation (already built) + what we just added
- **`grantCheck.ts`** — A2A zero-trust grant ledger: SPIFFE actor identity, grant bindings, policy hash, server attestation, revocation, audit to HellGraph (`mcp-a2a-zero-trust` schema-conformant). Answers *is this grant valid?*
- **`trust.ts` (NEW)** — behavioral trust per SPIFFE actor, so a grant's *strength* reflects track record. Answers *how much do we trust this actor right now?*

A grant decision now composes: **revoked? → trusted? → (if egress) scope-d allows?** Three checks, three concerns, never one blob.

## 2. The trust model (`trust.ts`)
```
score = 0.4·success + 0.2·uptime + 0.2·threat + 0.2·integrity      (components 0..1, higher = safer)
```
- **Slow upgrade** — `ok`/`up` outcomes raise success/uptime via EMA (α≈0.12); trust is *earned* over ~15-20 samples.
- **Instant downgrade** — a `threat` signal or `integrityViolation` is a **hard gate**: `trustVerdict` denies immediately (independent of the otherwise-high score) until the struck component EMA-recovers above 0.5. Integrity strikes (set to 0) recover slower than threat strikes (set to 0.1).
- **Cold start** — local actors (`spiffe://noetica.local/…`) start trusted (0.9); **external peers start cautious (0.4)** and must earn standing — they can't act as a high-trust node cold.
- **Capability-tiered floors** — sensitive capabilities pass a higher `floor` (e.g. 0.8) than routine ones (default 0.45). A cold peer can read-only but can't, say, write to the graph until it has a record.

Verified: `lib/a2a/trust.test.ts` (6 tests — earn, instant-down, slow recovery, integrity-slower, high-floor gate).

## 3. Peer frameworks as SPIFFE-actor profiles
A Ruflo swarm / gastown / AIWG node is just a **SPIFFE actor with a grant** in the existing ledger — no new trust substrate. Each is a *profile* (identity scheme + capability map + transport) over the same schema:

| Framework | Identity → SPIFFE | Transport | Capabilities exposed to it | Notes |
|---|---|---|---|---|
| **Ruflo** | `spiffe://ruflo.<swarm>/<queen\|worker>/<id>` (mTLS + ed25519 challenge per its federation model) | MCP / A2A | scoped tool grants; graph read; task delegation | maps its queen/worker actors to our grant ledger; its consensus is its own |
| **gastown** | *TBD — fill identity scheme when defined* | *TBD* | *TBD* | placeholder profile; same schema |
| **AIWG** | *TBD — fill when defined* | *TBD* | *TBD* | placeholder profile; same schema |

> gastown + AIWG specifics are unknown to me; the architecture is deliberately profile-pluggable so they slot in as rows above without touching the core. (Asked; pending.)

## 4. The compose: A2A gate THEN scope-d gate (kept separate on purpose)
```
peer request (SPIFFE actor, capability, grant, attestation)
   │
   ├─ grantCheck.checkActorGrant(spiffe, capability, floor)     ← identity + revocation + behavioral trust
   │      └─ deny → reject (record threat outcome → instant downgrade)
   │
   ├─ IF the action egresses data AND an EngagementPolicy is armed:
   │      scope-d.checkEgress(req)                                ← purple-team engagement / data-residency
   │      └─ deny → stay local / downgrade
   │
   └─ allow → execute → grantCheck.recordActorOutcome(spiffe, {ok, up, threat, integrityViolation})
```
scope-d is **consulted**, not absorbed: A2A = *who can do what*; scope-d = *may this data leave, under this engagement*. Two gates, distinct lifecycles.

## 5. The genuine new surface: the backend A2A endpoint
`grantCheck`/`trust` are **frontend** today. Real cross-machine federation needs the **agent-machine sidecar to speak the same A2A grant protocol** on the backend. Proposed contract (to build next):
- `POST /api/a2a/grant/validate` → `{ actor: {spiffe_id, attestation}, capability, grant_id }` → `GrantVerdict` (+ trust score). Token-gated like `/api/tool`.
- `POST /api/a2a/outcome` → `{ spiffe_id, outcome }` → records behavioral trust (durable + HellGraph audit, not just in-memory).
- `GET /api/a2a/peers` → the trust ledger (for the Govern surface).
- Trust ledger moves to durable storage (encrypted-at-rest, like the other stores) on the backend; the frontend ledger mirrors it.

## 6. What we adopt natively (the "good shit") vs interop-only
**Adopt natively (reimplement, don't import):**
- **Behavioral trust scoring** — done (`trust.ts`).
- **Principled consensus / anti-drift** — upgrade `council.ts`/`critic.ts` from weighted voting to a quorum/BFT posture (tolerate f<n/3) for high-stakes decisions. (next)
- **Explicit, runtime-adaptive topologies** (mesh/hierarchical/ring/star) made first-class in `orchestrator.ts`. (next)

**Interop-only (don't absorb):** Ruflo's swarm itself, its Q-learning router, SPARC — talk to them over A2A/MCP; keep our own routing taxonomy + verify-repair loop.

**Explicitly reject:** taking Ruflo as a dependency — it orchestrates cloud Claude Code/Codex, against the local-first/sovereign moat.

## 7. The guardrail
Ruflo's own caveat is the rule: **leverage, not magic — more agents ≠ better if specs are bad.** Federation widens *who* can help, not *how many warm bodies* to throw at a vague task. Every federated capability is trust-gated + egress-gated + audited; the value is harness discipline, not agent count.

## Open
- gastown / AIWG identity schemes + capability maps (fill §3 rows).
- Promote the `trust` dimension into the canonical `mcp-a2a-zero-trust` schema (currently a conformant local extension).
- Build the backend `/api/a2a/*` endpoint (§5) — the real federation surface.
- Consensus + topology upgrades (§6) as their own focused passes.
