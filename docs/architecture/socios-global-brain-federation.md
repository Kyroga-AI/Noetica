# SociOS Global Brain — opt-in federation of verified knowledge

**Status:** Design. The device brain is **local-first**: nothing leaves the machine by default. If
the user **opts in to SociOS** (the shared brain), verified crystallized knowledge — chiefly the
*solutions* the self-healing loop produces — propagates **both ways**: contributions go up, the
fleet's accumulated fixes come down. Extends incident-memory-and-self-healing.md and
skill-synthesis-verified-action.md.

Why this is safe to share at all: we federate **verified symbolic knowledge** (a cited, inspectable,
re-verifiable `{problem signature → procedure → verification}`), **not weights and not raw logs**. A
remote fix is a *hypothesis the local machine re-certifies* — never a black box you trust on faith.

---

## What federates (and what never does)

| Federates (opt-in, sanitized) | Stays local, always |
|---|---|
| **Skills** — resolved_by solutions: problem_class, intent cell, procedure, postconditions, rollback, verification ledger | Raw chat / working-tier episodes |
| **Incident signatures** — the *generalizable* correlated symbol set | Raw FailureAtoms (logs, stack traces, host context) |
| **Golden facts** — cited principles/laws (only if that category is opted in) | Estate TTL specifics (your topology, hosts, secrets) |
| | Anything that fails the sanitizer |

Federation is **per-category** — you can share operational fixes without sharing anything about your
estate or your golden corpus.

---

## The upload moat — sanitize before anything leaves

A contribution passes a **sanitizer gate** stricter than the action gate, or it stays home:
1. **Generalize** the problem_class to its portable form — keep `svc:<role> + err:<code>`, drop
   `host:my-box`, absolute paths, IPs, usernames, ports that encode topology.
2. **Redact** secrets/tokens/PII (the same scan the ledger uses), hard-fail on any hit.
3. **Keep only** `{signature → procedure → postcondition → verification-evidence}`. If the fix can't
   be expressed without machine-specific context, it is **not portable → not uploaded**.
4. **Sign + provenance** — anonymized contributor id, the gate ledger hash as proof the fix actually
   verified locally, a signature. No anonymous unverified claims enter the global brain.

---

## Aggregation — federated reinforcement

The global brain **dedupes by signature** and **aggregates confidence across independent
contributors**: a fix that verified on 50 machines outranks one that worked once. This is the
network effect made rigorous — corroboration is counted, not assumed. Conflicting fixes for the same
signature coexist, ranked by corroboration + recency + environment match.

---

## Pull — remote proposes, **local certifies**

A device hitting an *unseen* failure pulls candidate solutions from the global brain. Crucially they
arrive **untrusted**:

```
unseen failure → pull global candidates (by signature + symptom embedding)
   → rank by corroboration × environment-match
   → re-run THIS machine's VERIFIED-ACTION GATE from scratch
       (precondition / reversibility / lawful admissibility / ledger / postcondition)
   → execute only if it passes locally → sense → POS: adopt + mark locally-proven
```

A remote fix is never executed on its reputation. It's a hypothesis; the local gate is the physics
that certifies it on *this* machine. This is the same "LLM proposes, the law disposes" discipline,
lifted to "the fleet proposes, your gate disposes."

---

## Trust tiers (retrieval prefers proven)

```
locally-proven  >  globally-corroborated  >  globally-proposed (unverified here)
```
Every atom carries its origin, so troubleshooting retrieval prefers what *this* machine has already
verified, then well-corroborated fleet knowledge, then untried hypotheses — and a pulled fix is
promoted to *locally-proven* only after it passes the local gate.

---

## Guarantees

- **Opt-in, per-category, revocable** — default is fully local; SociOS changes nothing until enabled.
- **Sanitized + signed** — only generalizable, secret-free, verification-backed patterns leave;
  raw episodes and estate specifics never do.
- **Re-verified on arrival** — no remote fix runs without passing the local verified-action gate.
- **Cited end to end** — a federated solution still traces to the man pages/specs/laws it was
  composed from; auditable on both ends.

---

## The thesis, socialized
Local-first determinism means each machine *earns* its knowledge by verification. SociOS lets opted-in
machines **pool what they've earned** — so a problem solved once, anywhere, inoculates the fleet,
while every machine still certifies every fix against its own reality. Technique-not-horsepower
compounds: not a bigger model, a **bigger verified, shared, re-checkable memory**.
