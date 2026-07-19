#!/usr/bin/env python3
"""Deterministic unit tests for proxy_gate (stdlib only). Run: python3 scripts/proxy_gate_test.py"""
import proxy_gate as pg

# Synthetic ckpt, 4 questions, hand-computed expectations.
# baseline: T F T F   ground: T T F F   opcompute: F T T T
ROWS = [
    {"subject": "s1", "baseline_ok": True,  "ground_ok": True,  "opcompute_ok": False, "gate_agree": 0.9},
    {"subject": "s1", "baseline_ok": False, "ground_ok": True,  "opcompute_ok": True,  "gate_agree": 0.3},
    {"subject": "s2", "baseline_ok": True,  "ground_ok": False, "opcompute_ok": True,  "gate_agree": 0.8},
    {"subject": "s2", "baseline_ok": False, "ground_ok": False, "opcompute_ok": True,  "gate_agree": 0.2},
]

def approx(a, b, eps=1e-6): return abs(a - b) < eps

def test_probe():
    pr = pg.probe(ROWS, "ground", "baseline")
    assert pr.acc == 50.0 and pr.base_acc == 50.0, (pr.acc, pr.base_acc)
    assert pr.helped == 1 and pr.hurt == 1, (pr.helped, pr.hurt)   # q2 ground rescues, q3 ground loses
    assert pr.lift_pp == 0.0
    assert pr.per_subject["s1"]["net_pp"] == 50.0                  # base 50 -> ground 100 on s1
    print("ok probe")

def test_mcnemar():
    assert pg.binom_two_sided_p(0, 0) == 1.0
    assert approx(pg.binom_two_sided_p(0, 1), 1.0)                 # 2*C(1,0)*0.5 = 1.0
    assert approx(pg.binom_two_sided_p(0, 4), 2 * (1 / 16))        # only the k=0 term, doubled
    print("ok mcnemar")

def test_complementarity():
    comp = pg.complementarity(ROWS, ["baseline", "ground", "opcompute"])
    # opcompute solves q2,q3,q4; baseline q1,q3; ground q1,q2
    assert comp["single_acc"]["opcompute"] == 75.0
    assert comp["rescue_matrix"]["opcompute"]["baseline"] == 2   # q2,q4 opcompute-right/baseline-wrong
    assert comp["rescue_matrix"]["ground"]["opcompute"] == 1     # q1 ground-right/opcompute-wrong
    assert comp["unique_solves"]["opcompute"] == 1               # q4: only opcompute
    assert comp["oracle_union"] == 100.0                         # every q solved by someone
    print("ok complementarity")

def test_alignment():
    # gate_agree high on q1,q3 (baseline ok); low on q2,q4 (baseline wrong) -> perfectly separates baseline.
    # With BINARY truth the two tied ranks cap Spearman below 1.0 (0.894) — that is correct, not a bug.
    al = pg.alignment(ROWS, "gate_agree", "baseline")
    assert al["coverage"] == 4
    assert al["spearman"] >= 0.85 and al["trustworthy"], al
    # a reversed proxy anti-predicts -> strongly negative rho (still |rho|>=0.2, i.e. informative when inverted)
    rows_rev = [dict(r, rev=1.0 - r["gate_agree"]) for r in ROWS]
    assert pg.alignment(rows_rev, "rev", "baseline")["spearman"] <= -0.85
    # a flat proxy carries no signal -> rho 0.0, NOT trustworthy (must not gate on it: Goodhart floor)
    rows_flat = [dict(r, flat=0.5) for r in ROWS]
    al_flat = pg.alignment(rows_flat, "flat", "baseline")
    assert al_flat["spearman"] == 0.0 and not al_flat["trustworthy"], al_flat
    print("ok alignment")

def test_spearman_edges():
    assert pg.spearman([1, 2, 3], [1, 2, 3]) == 1.0
    assert pg.spearman([1, 2, 3], [3, 2, 1]) == -1.0
    assert pg.spearman([1, 1, 1], [1, 2, 3]) == 0.0   # degenerate
    print("ok spearman edges")

if __name__ == "__main__":
    test_probe(); test_mcnemar(); test_complementarity(); test_alignment(); test_spearman_edges()
    print("\nALL PASS")
