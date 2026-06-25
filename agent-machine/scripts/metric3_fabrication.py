#!/usr/bin/env python3
"""metric3_fabrication — Metric 3 (the liability number), derived from the Metric-1 confusion cells (no new
compute). The spec distinguishes two rates:

  • RAW fabrication rate      = fabricated claims / total claims   (a property of the GENERATIONS being judged —
                                here, RAGTruth's gpt-4/llama outputs — i.e. the benchmark's hallucination base rate)
  • MISLABELED rate (LIABILITY) = fabricated claims our system tags GROUNDED (P-RET) / total claims

The mislabeled rate is what a regulator cares about: a fabricated claim wearing a 'grounded' tag. In confusion
terms it is exactly the detector's FALSE NEGATIVES over all claims (FN / N) — a fabricated sentence the detector
called grounded. It must be near-zero; this reports how far from zero each detector actually is.

  python3 scripts/metric3_fabrication.py
"""
import os, json, glob

OUT = os.path.join(os.path.dirname(__file__), '..', 'canon', 'provenance-eval')

def main():
    rows = []
    for f in sorted(glob.glob(os.path.join(OUT, 'ragtruth-provenance*.json'))):
        d = json.load(open(f))
        s = d['sentence_level']
        tp, fp, fn, tn = s['tp'], s['fp'], s['fn'], s['tn']
        n = tp + fp + fn + tn
        fabricated = tp + fn                      # human-labeled hallucinated (the benchmark's fabrications)
        det = d.get('detector', 'sim')
        prem = d.get('nli_premise')
        name = det + (f'-{prem}' if prem else '')
        raw = fabricated / n if n else 0.0
        mislabeled = fn / n if n else 0.0         # fabricated BUT tagged grounded (the liability)
        caught = tp / fabricated if fabricated else 0.0
        rows.append((name, n, fabricated, raw, mislabeled, caught))
    rows.sort(key=lambda r: r[4])                 # best (lowest mislabeled) first

    print("=" * 72)
    print("METRIC 3 — FABRICATION RATE (raw = benchmark base rate; mislabeled = OUR liability)")
    print("RAGTruth held-out · 'mislabeled' = fabricated claim tagged GROUNDED = FN/N (want ~0)")
    print("=" * 72)
    print(f"\n{'detector':>12} {'claims':>7} {'fabricated':>10} {'raw-rate':>9} {'MISLABELED':>11} {'caught':>7}")
    for name, n, fab, raw, mis, caught in rows:
        print(f"{name:>12} {n:>7} {fab:>10} {raw:>9.3f} {mis:>11.3f} {caught:>7.3f}")

    raw_base = rows[0][3] if rows else 0.0
    print(f"\nThe benchmark's raw fabrication base rate is ~{raw_base:.1%} of sentences (a property of the judged")
    print("generations, not our system). What is OURS is the MISLABELED column: with the best current detector,")
    best = min(rows, key=lambda r: r[4]) if rows else None
    if best:
        print(f"{best[4]:.1%} of ALL claims are fabricated-yet-tagged-grounded ({best[0]}). That is NOT near-zero —")
        print("the liability number is real, and it is the headline argument for the inline-binding build (Phase 0.4)")
        print("plus a faithfulness-tuned detector: both exist to drive this column toward zero, measurably.")

    with open(os.path.join(OUT, 'metric3-fabrication.json'), 'w') as fo:
        json.dump([{'detector': n, 'claims': c, 'fabricated': fab, 'raw_rate': raw,
                    'mislabeled_rate': mis, 'caught_rate': caught}
                   for n, c, fab, raw, mis, caught in rows], fo, indent=2)
    print(f"\n# → {os.path.join(OUT, 'metric3-fabrication.json')}")

if __name__ == '__main__':
    main()
