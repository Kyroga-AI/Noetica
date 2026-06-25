#!/usr/bin/env python3
"""judge_ira — build-order item 3 (spec §4): judge–human inter-rater agreement. Span-level faithfulness scoring
needs an automated judge; the spec is emphatic that NO judge-produced number is trustworthy until its agreement
with human labels is established and reported alongside it. Every detector in provenance_eval IS an automated
judge of faithfulness, so this computes Cohen's κ (chance-corrected agreement) for each, against RAGTruth's human
span labels, from the confusion cells already in the manifests.

The gate: a judge whose κ is below 'substantial' (0.61) cannot be externalized to produce a standalone
faithfulness number — it disagrees with humans too often to be a measurement instrument. This is the number that
keeps the whole eval honest; without it a sophisticated evaluator discounts every judge-scored metric.

  python3 scripts/judge_ira.py
"""
import os, json, glob

OUT = os.path.join(os.path.dirname(__file__), '..', 'canon', 'provenance-eval')

def kappa(tp, fp, fn, tn):
    """Cohen's κ for two raters (judge vs human) over a binary label (hallucinated / faithful)."""
    n = tp + fp + fn + tn
    if not n:
        return 0.0, 0.0
    po = (tp + tn) / n                                   # observed agreement
    p_judge_pos = (tp + fp) / n                          # judge says 'hallucinated'
    p_human_pos = (tp + fn) / n                          # human says 'hallucinated'
    pe = p_judge_pos * p_human_pos + (1 - p_judge_pos) * (1 - p_human_pos)   # chance agreement
    k = (po - pe) / (1 - pe) if pe < 1 else 0.0
    return k, po

def band(k):
    # Landis & Koch
    return ('almost perfect' if k >= 0.81 else 'substantial' if k >= 0.61 else 'moderate' if k >= 0.41
            else 'fair' if k >= 0.21 else 'slight' if k >= 0.01 else 'none/worse-than-chance')

def main():
    rows = []
    for f in sorted(glob.glob(os.path.join(OUT, 'ragtruth-provenance*.json'))):
        d = json.load(open(f))
        s = d['sentence_level']
        det = d.get('detector', 'sim')
        prem = d.get('nli_premise')
        name = det + (f'-{prem}' if prem else '')
        k, po = kappa(s['tp'], s['fp'], s['fn'], s['tn'])
        rows.append((name, k, po, s['f1'], s['precision'], s['recall'], band(k)))
    rows.sort(key=lambda r: -r[1])

    print("=" * 74)
    print("JUDGE–HUMAN INTER-RATER AGREEMENT (Cohen's κ) — RAGTruth human span labels")
    print("the gate: κ < 0.61 ('substantial') ⇒ NOT trustworthy as a standalone faithfulness judge")
    print("=" * 74)
    print(f"\n{'judge (detector)':>16} {'κ':>7} {'obs-agree':>10} {'F1':>6} {'prec':>6} {'recall':>7}   interpretation")
    for name, k, po, f1, p, r, b in rows:
        print(f"{name:>16} {k:>7.3f} {po:>10.3f} {f1:>6.3f} {p:>6.3f} {r:>7.3f}   {b}")

    best = rows[0] if rows else None
    print("\nverdict:")
    if best and best[1] >= 0.61:
        print(f"  {best[0]} reaches κ={best[1]:.3f} ({best[6]}) — trustworthy as a faithfulness judge.")
    else:
        topk = best[1] if best else 0.0
        print(f"  best κ={topk:.3f} ({best[6] if best else 'n/a'}) — BELOW 'substantial'. No current detector")
        print(f"  qualifies as a standalone faithfulness judge against human labels. Per spec §4 this gates the")
        print(f"  judge-scored metrics: report κ beside every number, and the next build is a faithfulness-tuned")
        print(f"  detector (not repurposed token-overlap or general NLI) before any score is externalized.")

    with open(os.path.join(OUT, 'judge-ira.json'), 'w') as fo:
        json.dump([{'judge': n, 'kappa': k, 'observed_agreement': po, 'f1': f1,
                    'precision': p, 'recall': r, 'band': b} for n, k, po, f1, p, r, b in rows], fo, indent=2)
    print(f"\n# → {os.path.join(OUT, 'judge-ira.json')}")

if __name__ == '__main__':
    main()
