# Incident Memory & Self-Healing — capture, cluster, correlate, fix

**Status:** Design. The atomspace captures every failure, clusters them by time-window into
incidents, correlates across symbols, tags the solution, and makes it **findable in the brain**
so the next occurrence is a lookup. The on-device agent then **fixes the machine** by running the
tagged solution through the verified-action gate. Closes the loop with skill-synthesis-verified-
action.md and the operational/estate tiers.

---

## The loop

```
  SENSE failure  →  CAPTURE (FailureAtom)  →  CLUSTER (time-window → Incident)
       →  CORRELATE (symbol co-occurrence graph)  →  on resolve: TAG solution (→ Skill)
       →  FINDABLE (brain: vector + symbol + signature)
   next time:  failure → retrieve nearest incident → its tagged Skill
       → verified-action GATE → execute fix → sense postcondition
       → POS: reinforce solution | NEG: rollback + synthesize new fix → crystallize
```

Every failure becomes durable troubleshooting memory; every fix becomes a reusable, verified Skill.

---

## 1. Atoms

**FailureAtom** (episodic; captured from any error source — exit codes, stderr, logs, exceptions,
alerts, build/test failures, and the agent's *own* NEG verdicts from the verified-action gate):
```jsonc
{
  "label": "FailureAtom", "tier": "incident",
  "ts": "2026-06-21T18:42:07Z",
  "symbols": ["svc:prometheusd", "err:ECONNREFUSED", "port:8890", "file:main.py"], // entities involved
  "symptom": "prometheusd refused connection on :8890",        // text → embedding (findable)
  "embedding": "<base64 f32 768>",
  "context": { "estate_snapshot": "...", "host": "...", "process": "..." },         // world-state at failure
  "severity": "error|warn|fatal", "source": "stderr|log|exception|gate-NEG"
}
```

**Incident** (a temporal cluster of FailureAtoms — the unit of diagnosis):
```jsonc
{
  "label": "Incident", "tier": "incident",
  "window": { "start": "...", "end": "..." },
  "members": ["<FailureAtom ids>"],
  "signature": ["svc:prometheusd", "err:ECONNREFUSED", "port:8890"],  // the correlated symbol set
  "status": "open|resolved",
  "resolved_by": "Skill:restart-prometheusd",     // ← the tagged solution
  "resolution_evidence": { "postcondition": "POS", "ledger": "<hash>" }
}
```

**CorrelationEdge** (the empirical failure-dependency graph):
```jsonc
{ "label": "CorrelationEdge", "a": "svc:prometheusd", "b": "err:ECONNREFUSED",
  "cooccur": 14, "lift": 9.2, "lag_ms": 120 }   // how often / how strongly / leading-or-lagging
```

---

## 2. Cluster — by time and window

Group co-occurring failures into incidents by **temporal proximity + symbol overlap**:
- a sliding window (e.g. burst within N seconds) opens an Incident; FailureAtoms landing inside
  with ≥1 shared symbol join it; the window closes after a quiet gap.
- a cascade (X fails → Y fails → Z fails within the window) is **one** Incident, not three —
  which is exactly what stops the agent chasing symptoms instead of the cause.

Window size is per-source configurable; the Incident is the durable unit.

---

## 3. Correlate — across symbols

For each Incident, increment a `CorrelationEdge` for every symbol pair that co-occurs. Over many
incidents this yields the **empirical failure-dependency graph** — and crucially:

- it **complements the estate TTL**: `upstreamContract` is the *declared* dependency; the
  correlation graph is the *observed* one. A correlation with **lag** (A fails ~120ms before B)
  reveals the **causal direction** — the real culprit, not the loudest symptom.
- discrepancies (things that fail together but have no declared contract, or contracts that never
  co-fail) are themselves signal — undocumented coupling or dead contracts.
- **PROMETHEUS** can run SR over the failure time-series to discover failure *dynamics* (leading
  indicators, thresholds) and crystallize them as atoms — *data → failure-law*.

---

## 4. Tag the solution & make it findable

On resolution (the failure stops *and* a verified fix was applied), link `Incident --resolved_by-->
Skill` with the gate's postcondition + ledger as evidence. Findability is three-way:
- **vector** — symptom embedding → "have I seen this error before?" (the brain).
- **symbol** — graph match on the failing symbols (structural).
- **signature** — the correlated symbol set as an exact/fuzzy incident key.

A new failure retrieves the nearest past incidents (vector ∧ symbol) → their tagged Skills, ranked
by solution confidence (earned through successful re-use).

---

## 5. The self-healing repair loop (on-device, control-my-computer)

```
detect failure (sense)
  → capture FailureAtom → join/open Incident (window)
  → retrieve nearest resolved Incidents → candidate Skill(s)
  → high-confidence match?
       YES → run Skill through the VERIFIED-ACTION GATE (precondition/reversibility/lawful/ledger)
             → execute fix (computer-use) → sense postcondition
                 → POS: mark Incident resolved, REINFORCE solution (raise confidence)
                 → NEG: rollback, fall through to synthesize
       NO/NEG → SYNTHESIZE a new fix (skill-synthesis pipeline, grounded in ops + estate)
             → verify → gate-execute → POS: CRYSTALLIZE (Incident --resolved_by--> new Skill)
```

So the device **diagnoses from correlated history, fixes through the verified gate, and learns the
fix** — and the agent's own failed attempts (gate NEGs) feed straight back as FailureAtoms, so it
gets better at the *same* failure next time.

---

## 6. Self-improving + safe

- **The agent's own failures crystallize** — gate NEG verdicts are FailureAtoms; a fix that didn't
  work is negative evidence that demotes that Skill for that signature.
- **Safety is the gate** — every fix runs through the verified-action gate: precondition/type check,
  reversible-or-staged-rollback, lawful admissibility, ledgered, postcondition-checked. The
  prohibited-action boundary holds (no auto destructive/credential/financial action). describe →
  propose → verify → execute-with-guards.
- **Cite everything** — an incident's solution traces to the Skill, which traces to the man
  pages/specs/estate it was composed from. Auditable end to end.

## 7. Where it sits
The **incident tier** sits beside golden/ops/estate: episodic FailureAtoms that crystallize into
durable Incident-patterns + resolved_by-Skills. The brain makes them findable; the correlation
graph makes diagnosis causal (and validates/extends the estate TTL); the verified-action gate makes
the fix safe; PROMETHEUS can learn the failure dynamics. The result: an on-device agent that
**heals the machine from its own accumulated, verified troubleshooting memory.**
