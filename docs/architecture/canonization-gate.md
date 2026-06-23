# The canonization gate — two quorums, one loop

Design for connecting Noetica's **epistemic** quorum (which answer is right) to
SCOPE-D's **governance** quorum (which claim is allowed to become canon), with a
signed receipt that closes the learning loop.

## The gap

We already run both halves — in different repos, not connected:

- **Epistemic quorum (Noetica).** `agent-machine/scripts/meta_combiner.py` learns
  a weighted council law over the arms (`base, brain, elim, sc_agree, coverage,
  isA, kt_*`) two ways — softmax (logistic) and a symbolic law (gplearn) — and
  decides by argmax. `server.ts` runs the live council with self-consistency
  (K=3/5 + CISC) and symbolic selection. Output today: *an answer*.
- **Governance quorum (SCOPE-D).** `config/schemas/engagement-policy.schema.json`
  `approvalModel` includes `frost_quorum`; the LSA map's "two-witness knowledge
  promotion" requires "human or policy quorum for canonization of claims";
  `systems-learning-loops` carries the same doctrine (claim → canon → receipt).
  Input today: *not the council's output*.

So the council picks an answer, but **nothing governs whether that answer
becomes canon**, and the governance machinery that should govern it is fed by
hand. Epistemic confidence is not authority. This design wires them together.

## The pipeline

```
arms ─► [Gate A: epistemic council]  meta_combiner law + CISC + symbolic select
            │  emits
            ▼
       CandidateClaim  { answer, confidence (calibrated), evidence_refs, council_law_ref }
            │
            ▼
       [Gate B: governance quorum]   SCOPE-D approvalModel (single_human | human_and_policy | frost_quorum)
            │  emits
            ▼
       CanonizationDecision  { state: canon|rejected|deferred, witnesses[], dissent[] }
            │  on canon
            ▼
       CanonReceipt  (signed: FROST threshold sig and/or minisign)  ─►  canon store + evidence fabric
            │
            └────────────►  retrain signal  ─►  meta_combiner (council law) + per-arm calibration
```

Gate A says *who's right*; Gate B says *what's allowed to become canon*. Only
Gate B writes canon, and only with a signed receipt. Dissent is preserved
(SCOPE-D: "preserve dissent, prevent solo-hero promotion").

## Routing policy — which quorum a claim needs

Match the gate to the stakes (mirrors SCOPE-D's "no bridge diffusion without
quorum + signed proof leaves"):

| Claim class | Gate B model | Witnesses |
|-------------|--------------|-----------|
| Low-stakes, reversible, internal | `single_human` or auto | 1 (council itself) |
| Published / canonized / cross-domain | `human_and_policy_engine` | policy + 1 human |
| Bridge diffusion, irreversible, external action | `frost_quorum` | threshold N-of-M + human |

The class is a function of claim metadata (is it published? does it trigger an
action? is it canon?), not of confidence alone — high confidence does not buy
past Gate B for a high-stakes claim.

## Hand-off contract (the missing schemas)

Three small documents define the Noetica↔SCOPE-D↔evidence-fabric interface.
They should land in `sourceos-spec` (reasoning evidence family) and be vendored;
inline here as the design of record.

```jsonc
// CandidateClaim — emitted by Gate A (Noetica council)
{
  "id": "urn:srcos:claim:<id>",
  "type": "CandidateClaim",
  "answer": "…",                     // the council's selected output
  "confidence": 0.0,                 // CALIBRATED probability (see prerequisite)
  "evidence_refs": ["urn:srcos:…"],  // retrieval / compute-spine / proof refs
  "council": {
    "law_ref": "urn:srcos:tool:council-law@<ver>",  // the softmax/symbolic law used
    "arms": { "base": "B", "brain": "B", "elim": "C", "sc_agree": 0.8 },
    "selection": "symbolic"          // softmax | symbolic | cisc
  },
  "claim_class": "published"         // drives the routing policy above
}
```

```jsonc
// CanonizationDecision — emitted by Gate B (SCOPE-D governance quorum)
{
  "id": "urn:srcos:canon-decision:<id>",
  "type": "CanonizationDecision",
  "claim_ref": "urn:srcos:claim:<id>",
  "state": "canon",                  // canon | rejected | deferred
  "approval_model": "frost_quorum",  // from engagement-policy.schema.json
  "witnesses": [ { "kind": "human", "id": "…" }, { "kind": "policy-engine", "id": "…" } ],
  "dissent": [ ]                      // preserved minority positions
}
```

```jsonc
// CanonReceipt — the signed leaf written to canon + evidence fabric
{
  "id": "urn:srcos:canon-receipt:<id>",
  "type": "CanonReceipt",
  "decision_ref": "urn:srcos:canon-decision:<id>",
  "canon_state": "canon",
  "signatures": [ { "scheme": "frost", "sig": "…" }, { "scheme": "minisign", "sig": "…" } ],
  "sealed_at": "2026-06-22T00:00:00Z"
}
```

## Wiring points (where the code changes)

- **Noetica** `agent-machine`: after council selection (`server.ts` selection
  path + `meta_combiner` law), emit a `CandidateClaim` instead of returning the
  bare answer — new `lib/canonization.ts` builder. Reuses the existing
  reasoning-evidence emission.
- **SCOPE-D**: consume `CandidateClaim` at the `engagement-policy` gate; run the
  `approvalModel` (two-witness / `frost_quorum`); emit `CanonizationDecision` +
  sign a `CanonReceipt`. SCOPE-D already owns this governance surface.
- **Evidence fabric** (`sourceos-spec` reasoning family): persist `CanonReceipt`;
  expose canon outcomes for retraining.
- **Loop closure** `meta_combiner.py`: add the canon outcome as a training label
  (its `# next:` already calls for retraining as transcripts accumulate) and a
  feature; recalibrate per-arm confidence on the same stream.

## Prerequisite — calibration before the gate

Gate B's thresholds and CISC both trust `confidence`. Add per-arm
temperature/Platt scaling so `CandidateClaim.confidence` is a true probability
before it drives a canonization threshold. Cheapest high-leverage fix; do it
first.

## Why this is the missing half of the loop

`systems-learning-loops` defines the doctrine (observation → claim → pattern →
countermeasure → **receipt** → reobservation) but no mechanism binds the
reasoning engine's output to it. This gate is that binding: the council proposes
(chomer → tzurah: signals → law), governance disposes (canon under witnessed,
signed quorum), and the signed receipt feeds back as the next training signal.
Epistemic strength + governed canonization + a closed retraining loop — the
three were built separately; this is the seam.
