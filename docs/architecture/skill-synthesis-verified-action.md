# Skill Synthesis & the Verified-Action Gate

**Status:** Design. The concrete spec for on-demand skill generation and safe on-device control.
A skill is a **crystallized, verified, cited procedure**; the verified-action gate is the moat that
makes `execute` on the world substrate trustworthy. Builds on the operational tier
(operational-knowledge-tier.md), the 23×6 Intent Algebra (intent_algebra_spine.md), and the
learning loop (neurosymbolic-learning-plan.md).

---

## 1. The Skill atom

A successful, verified procedure crystallizes into a `Skill` atom — reusable, so the *next*
instance is a retrieval, not a re-synthesis. Skills compose (a skill's steps may invoke skills).

```jsonc
{
  "label": "Skill",
  "tier": "skill",
  "name": "clear-build-artifacts",
  "problem_class": "free disk by removing regenerable build output",   // for routing/retrieval
  "intent": { "topic": "operating_systems", "action": "execute", "substrate": "world" }, // 23×6 cell
  "domain": "operating_systems", "knowledge_type": "Procedural",
  "preconditions":  ["target dir exists", "all targets match /(node_modules|dist|\\.next|target)$/"],
  "procedure":      [ /* ordered Steps, §2 */ ],
  "postconditions": ["targets absent", "free disk increased", "no tracked source removed"],
  "rollback":       { "strategy": "snapshot-then-act", "snapshot": "tar of targets to /tmp before rm" },
  "sources":        ["man:rm.1", "man:du.1", "estate:repo/Noetica#techStack", "golden:filesystems"],
  "verification":   { "dry_run": "passed", "type_check": "passed", "last_postcondition": "POS" },
  "provenance":     { "synthesized_at": "...", "from_problem": "<hash>", "by": "skill-synth", "sha256": "..." },
  "tv": { "strength": 1.0, "confidence": 0.9 },   // confidence rises with successful re-use
  "av": { "sti": "persistent" }
}
```

Confidence is **earned**: a freshly-synthesized skill starts lower; each verified re-use raises it.
A skill whose postcondition ever fails is demoted (and the failure ledgered).

---

## 2. The Step (a typed 23×6 action)

Each step is one Intent-Algebra action with its own pre/post and rollback — the unit the gate checks.

```jsonc
{
  "i": 1,
  "action": "sense|evaluate|transform|execute|retrieve|create",
  "substrate": "world|held|store",
  "op": "du -sh node_modules",          // concrete operation (shell, click, API call)
  "precondition": "path exists && readable",
  "expected_effect": "prints a size; no state change",   // predicted postcondition
  "reversible": true,
  "rollback_op": null                   // for write steps: how to undo
}
```

The `sense → evaluate → transform → execute → sense` loop *is* the control loop: observe state,
check precondition, plan, act, confirm. Read steps (`sense`/`retrieve`/`evaluate`) are free to run;
**write steps (`execute`/`create`/`transform`) pass the gate.**

---

## 3. The verified-action gate (the moat)

The discipline that made compute trustworthy — *"the LLM proposes, physics disposes"* — applied to
actions. No write step fires until it clears the gate. This is **`Truth = Law × Evidence`** from the
Intent Algebra lawful-dispatch contract.

**Before `execute` (Law + Gate):**
1. **Type / precondition check** — does world-state match the step's assumptions? (targets match the
   declared type/pattern; command exists; perms ok). *Type mismatch → REFUSE* (the action moat).
2. **Reversibility check** — reversible, OR a rollback/snapshot is staged? Destructive + irreversible
   + no backup → REFUSE or require explicit human confirm (the prohibited-action boundary still holds:
   never auto-`rm`/overwrite/`sudo` an unverified target).
3. **Admissibility (Law)** — the step's constraint set must clear given context; produce a Verdict.

**Execute (Evidence):**
4. **Ledger** — content-addressed input, gate decision, constraint residual, the op, predicted effect,
   actual effect, SHA-256 hash chain. Deterministic replay; full audit trail.

**After `execute` (Verdict):**
5. **Postcondition check via `sense`** — did the predicted effect happen?
   - **POS** → continue; on full success, crystallize the Skill.
   - **NEG** → **rollback** (run `rollback_op` / restore snapshot), halt, record negative evidence.

```
write step → [type/precond?] → [reversible or rollback staged?] → [admissible?]
           → LEDGER → execute → sense(postcondition?) → POS:continue | NEG:rollback+halt
```

---

## 4. Synthesis lifecycle

```
problem → route (domain × knowledge-type → Procedural → skill-synth)
  ├─ LOOKUP: matching Skill atom? → retrieve + run (fast path)
  └─ SYNTHESIZE (no match):
       1. retrieve OPS knowledge (man pages/docs for the tools) + ESTATE state (TTL)
       2. compose candidate procedure (typed Steps), grounding every op in a cited source
       3. verify: dry-run each step, precondition + type-check (no execution yet)
       4. execute through the gate (§3) — lawful, ledgered, rollback-ready, step by step
       5. postconditions all POS?
            → CRYSTALLIZE Skill atom (cited, guarded, provenance)   [the loop closes]
            → else rollback + record failure (negative evidence; do NOT crystallize)
```

The KB **grows its own skill library**, grounded and verified — the flywheel: more problems →
more skills → faster, safer, more capable, with every skill traceable to its operational sources.

---

## 5. Safety guarantees (carried from the spine)

- **Verified, not asserted** — no write step executes whose preconditions/type don't verify.
- **Reversible or refused** — destructive irreversible actions need a staged rollback or a human; the
  prohibited-action boundary (no auto credential/permission/delete/financial) is absolute.
- **Cite the source** — every op traces to a man page / spec / estate atom / golden principle.
- **Ledger everything** — content-addressed, hash-chained, replayable. *Determinism/integrity/
  auditability — no legal/evidentiary claim* (v13 §1.8 scope discipline).
- **Describe → propose → verify → execute-with-guards** — never blind action. `controlAuthority`
  is granted per-cell by the lawful gate, never assumed.

## 6. The honest hard parts
1. **World-state typing is fuzzier than dimensional analysis** — a real "type system for system state"
   (file types, process states, idempotency, reversibility) is the genuine research surface. Start
   coarse (pattern + dry-run + reversibility) — even that beats unverified action decisively.
2. **Rollback coverage** — not every world action is cleanly reversible; the gate must *know* which
   are and snapshot before the rest.
3. **Grounding quality** — a skill is only as trustworthy as the ops/estate knowledge it composes
   from; hence the man-page + docs + estate-TTL capture is load-bearing.

## 7. Where it sits
OPS tier (vocabulary) + ESTATE tier (environment/state) + GOLDEN tier (principles) → composed by the
chainer into **Skill-tier atoms**, dispatched through the 23×6 `execute`/`sense` World loop, gated by
lawful dispatch. Same moat as verified compute — pointed at the world substrate.
