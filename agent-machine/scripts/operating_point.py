#!/usr/bin/env python3
"""operating_point — choose the detector's decision threshold for a given COST ASYMMETRY, from the per-sentence
scores saved by provenance_eval.py, with NO model recompute. This is the knob: the eval ships an opinionated
default (β=2, recall-weighted — a missed fabrication costs more than a false flag in the regulated tier), but the
asymmetry is the customer's to set, and they set it here in milliseconds against saved scores rather than re-running
the model.

Three ways to express the same policy (pick one):
  BETA=b           maximize Fβ           (β>1 favors recall; β=1 is balanced F1; β<1 favors precision)
  COST_RATIO=C     minimize  C·FN + FP   (a missed fabrication costs C× a false flag — the most direct framing)
  TARGET_RECALL=r  cheapest τ (max precision / fewest false flags) that still catches ≥ r of fabrications

  python3 scripts/operating_point.py [tag]              # sweep + presets (tag defaults to 'combo')
  COST_RATIO=6 python3 scripts/operating_point.py combo
  TARGET_RECALL=0.9 python3 scripts/operating_point.py nli

tag ∈ {sim, nli, nli-union, combo} — whichever scores.<tag>.jsonl exist.
"""
import os, sys, json, math

OUT = os.path.join(os.path.dirname(__file__), '..', 'canon', 'provenance-eval')

def load(tag):
    p = os.path.join(OUT, f'scores.{tag}.jsonl')
    if not os.path.exists(p):
        avail = [f[len('scores.'):-len('.jsonl')] for f in os.listdir(OUT) if f.startswith('scores.')]
        sys.exit(f"no saved scores for '{tag}'. Available: {avail or '(none — run provenance_eval.py first)'}")
    return [json.loads(l) for l in open(p) if l.strip()]

def confusion(recs, tau):
    tp = fp = fn = tn = 0
    for r in recs:
        pred = r['support'] < tau           # 'unsupported' / flagged
        if pred and r['halluc']: tp += 1
        elif pred and not r['halluc']: fp += 1
        elif not pred and r['halluc']: fn += 1
        else: tn += 1
    return tp, fp, fn, tn

def metrics(recs, tau):
    tp, fp, fn, tn = confusion(recs, tau)
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (tp, fp, fn, tn)

def fbeta(p, r, beta):
    b2 = beta * beta
    return (1 + b2) * p * r / (b2 * p + r) if (b2 * p + r) else 0.0

def main():
    tag = next((a for a in sys.argv[1:] if not a.startswith('-')), 'combo')
    recs = load(tag)
    n = len(recs)
    taus = [i / 100 for i in range(5, 100)]
    print(f"# operating_point — detector '{tag}', {n} saved sentences (no model recompute)\n")

    mode = None
    if os.environ.get('COST_RATIO'):
        C = float(os.environ['COST_RATIO']); mode = ('cost', C)
    elif os.environ.get('TARGET_RECALL'):
        R = float(os.environ['TARGET_RECALL']); mode = ('recall', R)
    elif os.environ.get('BETA'):
        b = float(os.environ['BETA']); mode = ('beta', b)

    if mode:
        kind, val = mode
        if kind == 'cost':
            # minimize expected cost C·FN + FP
            best = min(taus, key=lambda t: (lambda c: val * c[2] + c[1])(confusion(recs, t)))
            note = f"minimizing {val}·FN + FP  (a missed fabrication costs {val}× a false flag; β≈{math.sqrt(val):.2f})"
        elif kind == 'recall':
            # smallest τ (max precision) that still hits recall ≥ val
            ok = [t for t in taus if metrics(recs, t)[1] >= val]
            best = min(ok) if ok else max(taus)
            note = f"max-precision τ achieving recall ≥ {val}"
        else:
            best = max(taus, key=lambda t: fbeta(*metrics(recs, t)[:2], val))
            note = f"maximizing F{val}"
        p, r, (tp, fp, fn, tn) = metrics(recs, best)
        print(f"chosen τ = {best:.2f}   ({note})")
        print(f"  precision={p:.3f}  recall={r:.3f}  F1={fbeta(p,r,1):.3f}")
        print(f"  confusion: TP={tp} FP={fp} FN={fn} TN={tn}")
        print(f"  ⇒ catches {r:.0%} of fabrications; flags {fp} faithful sentences as the price; "
              f"{fn} fabrications still slip through tagged grounded.")
        if kind == 'cost' and r < 0.1:
            # cost-min collapses to "flag nothing" when the ratio can't overcome the detector's false-flag rate.
            # A flag pays off only when COST_RATIO > 1/precision_at_that_point; below that, doing nothing is cheaper.
            pmax = max((metrics(recs, t)[0] for t in taus if metrics(recs, t)[0] > 0), default=0.15)
            print(f"  ⚠ cost-optimal here is ~flag-nothing: at this detector's precision (≈{pmax:.2f}) a flag only")
            print(f"    pays off when COST_RATIO ≳ {1/pmax:.0f}. For a guaranteed catch rate use TARGET_RECALL instead.")
        return

    # default: show the trade across presets so the choice is transparent
    print(f"{'profile':>22} {'τ':>5} {'prec':>6} {'recall':>7} {'F1':>6}   confusion(TP/FP/FN/TN)")
    presets = [('precision-favoring (β=.5)', ('beta', 0.5)), ('balanced F1 (β=1)', ('beta', 1.0)),
               ('recall-weighted (β=2) ⋆', ('beta', 2.0)), ('strict-review (β=3)', ('beta', 3.0)),
               ('catch ≥90% (recall floor)', ('recall', 0.9)), ('catch ≥95% (recall floor)', ('recall', 0.95))]
    for label, (kind, val) in presets:
        if kind == 'beta':
            t = max(taus, key=lambda x: fbeta(*metrics(recs, x)[:2], val))
        else:
            ok = [x for x in taus if metrics(recs, x)[1] >= val]; t = min(ok) if ok else max(taus)
        p, r, (tp, fp, fn, tn) = metrics(recs, t)
        print(f"{label:>22} {t:>5.2f} {p:>6.3f} {r:>7.3f} {fbeta(p,r,1):>6.3f}   {tp}/{fp}/{fn}/{tn}")
    print(f"\n⋆ shipped default. Override per-tier:  COST_RATIO=<n> | TARGET_RECALL=<r> | BETA=<b>"
          f"  python3 scripts/operating_point.py {tag}")

if __name__ == '__main__':
    main()
