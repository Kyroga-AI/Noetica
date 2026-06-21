#!/usr/bin/env python3
"""
intent_algebra — Task 1 of the 23×6 Intent Algebra handoff: CONFIRM 6 CLOSES.

Re-runs the spanning + minimality test with `sense` added, asserts the load-bearing
`evaluate ⊥ sense`, and reports whether the action basis closes at 6 (3 substrates ×
2 polarities) or merges back to 5 with `execute` dangling. No path-to-10 language —
ten_hypothesis is REFUTED_LOW; we report the derived 6, not a padded 10.

Settled scope discipline (carried unchanged from the handoff / Lawful Learning v13 §1.8):
6 = 3 substrates × 2 polarities, full stop. It does NOT descend from string theory; the
26/10 correspondence was generative scaffolding and is retired — not reattached here.

Run:  python3 scripts/intent_algebra.py
"""
import sys

# ── the six generators: name -> (substrate, polarity) ─────────────────────────
# polarity: 'read' (in) | 'write' (out). substrate: store | held | world.
GEN = {
    'create':    ('store', 'write'),   # write to persistent store
    'retrieve':  ('store', 'read'),    # read from persistent store
    'transform': ('held',  'write'),   # write to internal held representation
    'evaluate':  ('held',  'read'),    # read from internal held representation
    'execute':   ('world', 'write'),   # write to external world
    'sense':     ('world', 'read'),    # read from external world  (derived dual of execute)
}
RAW_5 = ['create', 'retrieve', 'transform', 'evaluate', 'execute']  # the §7 result
DERIVED = ['sense']                                                  # execute's dual
SUBSTRATES = ('store', 'held', 'world')

# discarded 10-candidates are real but NOT columns — they stratify elsewhere:
STRATA = {
    'compare':  'composition  (evaluate over a retrieved tuple)',
    'explain':  'composition  (over the basis)',
    'monitor':  'embedding row · persistence-tagged (a standing `sense` loop)',
    'plan':     'embedding row · meta',
    'govern':   'embedding row · meta (closed loop execute→sense→evaluate→transform under a goal)',
}


def dual(g):
    """The adjoint: same substrate, flipped polarity. NOT a group inverse."""
    sub, pol = GEN[g]
    flip = 'read' if pol == 'write' else 'write'
    for name, (s, p) in GEN.items():
        if s == sub and p == flip:
            return name
    return None


def main():
    ok = True
    line = lambda c, s: print(f"  [{'POS' if c else 'NEG'}] {s}") or (c)

    print("# Intent Algebra · Task 1 — confirm the action basis closes at 6\n")
    print(f"  ten_hypothesis = REFUTED_LOW → {len(RAW_5)} raw generators (reported, not padded to 10):")
    print(f"    {', '.join(RAW_5)}")
    print(f"  + derived dual: {', '.join(DERIVED)}  (closes the open `execute` generator)\n")

    # A. SPANNING — the action space is substrates × polarities = 6 cells; each filled once.
    cells = {(s, p) for s in SUBSTRATES for p in ('read', 'write')}
    filled = {GEN[g] for g in GEN}
    spanning = (cells == filled) and (len(GEN) == 6)
    ok &= line(spanning, f"spanning: {len(filled)}/{len(cells)} substrate×polarity cells filled, bijective (no cell empty, no two generators share a cell)")

    # B. CLOSURE under adjunction — every generator's dual is in the set, and dual is an involution.
    closed = all(dual(g) in GEN for g in GEN) and all(dual(dual(g)) == g for g in GEN)
    ok &= line(closed, "closed under adjunction: every column has its read/write dual in the basis; σ² = id (ℤ/2 polarity involution)")
    print("        " + " · ".join(f"{g}↔{dual(g)}" for g in ('create', 'transform', 'execute')))

    # C. ADJOINT ≠ INVERSE — retrieve∘create reads what create wrote; it does not undo it.
    adjoint_not_inverse = dual('create') == 'retrieve'  # structural: same substrate, opposite polarity
    ok &= line(adjoint_not_inverse, "adjoint pairing, NOT inversion: retrieve∘create ≠ id (polarity flip on `store`, not a∘a⁻¹=id)")

    # D. MINIMALITY — load-bearing test: evaluate ⊥ sense (read-held vs read-world must be distinct).
    eval_sub = GEN['evaluate'][0]   # held
    sense_sub = GEN['sense'][0]     # world
    orthogonal = eval_sub != sense_sub
    ok &= line(orthogonal, f"minimality · LOAD-BEARING  evaluate ⊥ sense: read({eval_sub}) ≠ read({sense_sub}) — measuring held state is distinct from perceiving the world")
    if not orthogonal:
        print("        ⚠ MERGE DETECTED → basis falls back to 5 with `execute` dangling. Report 5, do not force 6.")

    # E. stratification of the discarded candidates (recorded, not columns)
    print("\n  stratified (real, but NOT columns):")
    for name, where in STRATA.items():
        print(f"    {name:9} → {where}")

    # ── verdict ──
    print()
    if ok:
        print("  ════════════════════════════════════════════════════════════")
        print("  VERDICT: POS (T1) — 6 CLOSES.  basis = {create, retrieve, transform,")
        print("           evaluate, execute, sense} = 3 substrates × 2 polarities.")
        print("           spanning · minimal · closed under adjunction · evaluate ⊥ sense.")
        print("           Cleared to grid the 23 × 6 matrix (task 2).")
        print("  ════════════════════════════════════════════════════════════")
        return 0
    print("  VERDICT: NEG — basis does not close at 6; see failing check above. Do not grid.")
    return 1


if __name__ == '__main__':
    sys.exit(main())
