#!/usr/bin/env python3
"""
proxy_gate — TA-E: the empirical proxy-gate for promoting core primitives ("one-shots").

A core primitive does NOT advance past a stub until a CHEAP, ALIGNMENT-VALIDATED proxy shows it
adds DECORRELATED marginal value. Three mechanisms, all $0/local over EXISTING board transcripts
(ckpt-*.jsonl) — no GPU, no fresh model calls:

  1. probe(arm, baseline)    — EMPIRICAL SAMPLING: lift + exact-McNemar p + per-subject breakdown,
                               estimated from artifacts we already have.
  2. complementarity(arms)   — LINKING: pairwise unique-rescue matrix + union ceiling. A one-shot
                               earns a seat ONLY if it is decorrelated (rescues questions the
                               incumbents miss) — never by nudging a correlated average. Confirms
                               the composite-combiner-ceiling lesson: weak-but-correlated arms drag
                               a vote down; decorrelated arms lift the oracle.
  3. alignment(proxy, truth) — PROXY ALIGNMENT: Spearman rank-corr between a CHEAP proxy signal and
                               the REAL outcome. An uncalibrated proxy is worse than none (Goodhart:
                               once the proxy becomes the target it stops measuring) — so this is the
                               gate on whether we are allowed to trust the gate.

Each arm emits a uniform marginal-value RECEIPT (lift / p / unique_rescues / alignment) so probes
across different primitives are directly comparable and the complementarity matrix composes itself.

Rows are ckpt.jsonl records carrying <arm>_ok booleans (see scripts/mmlu-brain-bench.ts) and an
optional 'subject'. Stdlib only — runs anywhere, costs nothing.

CLI:
  python3 proxy_gate.py CKPT.jsonl --baseline baseline --arms brain,ground,opcompute,prod \
      [--proxy gate_agree --truth ground]
"""
from __future__ import annotations
import argparse, json, sys
from dataclasses import dataclass, asdict
from math import comb


# ---------- io ----------
def load(path: str) -> list[dict]:
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def ok(row: dict, arm: str) -> bool:
    """A ckpt <arm>_ok cell, tolerant of bool / 'True' / 1 shapes."""
    return str(row.get(f"{arm}_ok")).lower() in ("true", "1")


def as_float(row: dict, key: str):
    try:
        return float(row.get(key))
    except (TypeError, ValueError):
        return None


# ---------- 1. empirical sampling ----------
def binom_two_sided_p(k: int, n: int) -> float:
    """Exact two-sided sign/McNemar p over n discordant pairs, k = the smaller cell. p=1 when n=0."""
    if n == 0:
        return 1.0
    tail = sum(comb(n, i) for i in range(0, min(k, n - k) + 1)) * (0.5 ** n)
    return min(1.0, 2 * tail)


@dataclass
class ProbeResult:
    arm: str
    baseline: str
    n: int
    acc: float          # arm accuracy (%)
    base_acc: float     # baseline accuracy (%)
    lift_pp: float      # acc - base_acc, in points
    helped: int         # arm right, baseline wrong
    hurt: int           # baseline right, arm wrong
    mcnemar_p: float    # exact two-sided p on the (helped, hurt) discordant pairs
    significant: bool   # p < 0.05
    per_subject: dict   # subject -> {n, base, arm, net_pp}


def probe(rows: list[dict], arm: str, baseline: str) -> ProbeResult:
    n = len(rows)
    acc = 100 * sum(ok(r, arm) for r in rows) / n
    base = 100 * sum(ok(r, baseline) for r in rows) / n
    helped = sum(1 for r in rows if ok(r, arm) and not ok(r, baseline))
    hurt = sum(1 for r in rows if ok(r, baseline) and not ok(r, arm))
    p = binom_two_sided_p(min(helped, hurt), helped + hurt)
    persub = {}
    for s in sorted({r.get("subject", "?") for r in rows}):
        sr = [r for r in rows if r.get("subject", "?") == s]
        ba = 100 * sum(ok(r, baseline) for r in sr) / len(sr)
        ta = 100 * sum(ok(r, arm) for r in sr) / len(sr)
        persub[s] = {"n": len(sr), "base": round(ba, 1), "arm": round(ta, 1), "net_pp": round(ta - ba, 1)}
    return ProbeResult(arm, baseline, n, round(acc, 1), round(base, 1), round(acc - base, 1),
                       helped, hurt, round(p, 4), p < 0.05, persub)


# ---------- 2. linking by complementarity ----------
def complementarity(rows: list[dict], arms: list[str]) -> dict:
    """Pairwise unique-rescue matrix + union ceilings. rescue[a][b] = #Qs a solves that b misses.
    An arm's decorrelation value = the Qs it uniquely solves among the whole set."""
    n = len(rows)
    single = {a: round(100 * sum(ok(r, a) for r in rows) / n, 1) for a in arms}
    rescue = {a: {} for a in arms}
    for a in arms:
        for b in arms:
            if a == b:
                continue
            rescue[a][b] = sum(1 for r in rows if ok(r, a) and not ok(r, b))
    unique = {a: sum(1 for r in rows if ok(r, a) and not any(ok(r, o) for o in arms if o != a))
              for a in arms}
    union_all = round(100 * sum(any(ok(r, a) for a in arms) for r in rows) / n, 1)
    return {"single_acc": single, "unique_solves": unique, "rescue_matrix": rescue,
            "oracle_union": union_all}


# ---------- 3. proxy alignment ----------
def _rank(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1  # 1-based average rank over the tie block
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(a: list[float], b: list[float]) -> float:
    """Spearman rank correlation, stdlib. Returns 0.0 on degenerate (constant) input."""
    if len(a) != len(b) or len(a) < 2:
        return 0.0
    ra, rb = _rank(a), _rank(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    da = sum((x - ma) ** 2 for x in ra) ** 0.5
    db = sum((y - mb) ** 2 for y in rb) ** 0.5
    return round(num / (da * db), 3) if da and db else 0.0


def alignment(rows: list[dict], proxy_key: str, truth_arm: str) -> dict:
    """Does a CHEAP proxy signal (proxy_key column) predict the REAL per-question outcome
    (truth_arm's correctness)? Spearman over the rows that carry the proxy. High |rho| => the
    proxy is trustworthy for future cheap decisions on this primitive; low => it lies, redesign."""
    xs, ys = [], []
    for r in rows:
        v = as_float(r, proxy_key)
        if v is not None:
            xs.append(v)
            ys.append(1.0 if ok(r, truth_arm) else 0.0)
    rho = spearman(xs, ys)
    return {"proxy": proxy_key, "truth": truth_arm, "coverage": len(xs), "spearman": rho,
            "trustworthy": abs(rho) >= 0.2}  # weak floor; calibrate per primitive


# ---------- receipt + CLI ----------
def receipt(rows: list[dict], arm: str, baseline: str, unique: int) -> dict:
    pr = probe(rows, arm, baseline)
    d = asdict(pr)
    d.pop("per_subject")
    d["unique_solves"] = unique
    d["earns_seat"] = (pr.significant and pr.lift_pp > 0) or unique > 0  # significant win OR decorrelated
    return d


def main() -> int:
    ap = argparse.ArgumentParser(description="TA-E proxy-gate over a board ckpt.jsonl")
    ap.add_argument("ckpt")
    ap.add_argument("--baseline", default="baseline")
    ap.add_argument("--arms", required=True, help="comma-separated arms to gate")
    ap.add_argument("--proxy", help="a proxy signal column to align (e.g. gate_agree)")
    ap.add_argument("--truth", help="the arm whose real outcome the proxy should predict")
    ap.add_argument("--json", action="store_true", help="emit machine-readable receipts")
    a = ap.parse_args()
    rows = load(a.ckpt)
    arms = [x.strip() for x in a.arms.split(",") if x.strip()]
    comp = complementarity(rows, [a.baseline] + arms)
    receipts = [receipt(rows, arm, a.baseline, comp["unique_solves"].get(arm, 0)) for arm in arms]

    if a.json:
        out = {"n": len(rows), "baseline": a.baseline, "receipts": receipts, "complementarity": comp}
        if a.proxy and a.truth:
            out["alignment"] = alignment(rows, a.proxy, a.truth)
        print(json.dumps(out, indent=2))
        return 0

    print(f"n={len(rows)}  baseline={a.baseline} ({comp['single_acc'].get(a.baseline)}%)")
    print(f"{'arm':12}{'acc':>7}{'lift':>7}{'help':>6}{'hurt':>6}{'p':>8}{'uniq':>6}  seat")
    for r in receipts:
        print(f"{r['arm']:12}{r['acc']:>7}{r['lift_pp']:>+7}{r['helped']:>6}{r['hurt']:>6}"
              f"{r['mcnemar_p']:>8}{r['unique_solves']:>6}  {'YES' if r['earns_seat'] else 'no'}")
    print(f"\noracle union (perfect per-Q pick) = {comp['oracle_union']}%")
    if a.proxy and a.truth:
        al = alignment(rows, a.proxy, a.truth)
        verdict = "TRUSTWORTHY" if al["trustworthy"] else "MISLEADING — do not gate on it"
        print(f"\nproxy alignment: {al['proxy']} vs real {al['truth']} outcome  "
              f"spearman={al['spearman']} (cov {al['coverage']}) => {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
