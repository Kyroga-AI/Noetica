#!/usr/bin/env python3
"""
course-recovery — WHICH CLASSES did we fail in? Per-course recovery scorecard, so we target the worst-mangled
courses and ground them. For each course: how many of its formulas link to a canonical equation (recovered)
vs not (still mangled). Low per-course recovery = a class whose PDFs our extraction mauled.

The recovery plan this enables (per course):
  1. SCORE   each course's recovery rate (here)
  2. GROUND  the course's expected equations via canon (AP sheets) + Wikidata/Wikipedia (validate-canon) +
             the course's topic — a course is e.g. 8.01 Classical Mechanics → expect Newton/kinematics/energy
  3. LINK to the NON-mangled version: the canonical clean form, or a sibling/duplicate course's better
             extraction, or the course's own clean .srt transcript — substitute it for the mangled instance

This file does step 1 + the canon-grounded link, and reports the duplicate offerings that give cross-checks.

Run:  OCW_BRAIN=… python3 scripts/course-recovery.py [domain ...]   (WORST=N courses to show, default 15)
"""
import os, sys, re, json, collections, importlib.util

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('cf', os.path.join(HERE, 'scripts', 'clean-formulas.py'))
cf = importlib.util.module_from_spec(spec); sys.argv = ['cf']; spec.loader.exec_module(cf)

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
WORST = int(os.environ.get('WORST', '15'))
MIN_FORMULAS = int(os.environ.get('MIN_FORMULAS', '20'))   # only score courses with enough formulas to judge
MATERIAL = {'reference', 'lecture', 'solution', 'exam', 'assignment', 'recitation'}


def main():
    fields = sys.argv[1:] or [d for d in cf.canon if not d.startswith('_')]
    for field in fields:
        d = os.path.join(BRAIN, field)
        if not os.path.isdir(d):
            print(f"  {field}: no brain dir"); continue
        eqs = cf.canon.get(field, [])
        per = collections.defaultdict(lambda: {'total': 0, 'linked': 0, 'eqs': set()})
        for fn in os.listdir(d):
            if not fn.endswith('.jsonl'):
                continue
            for ln in open(os.path.join(d, fn), errors='replace'):
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                if o.get('material') not in MATERIAL:
                    continue
                course = (o.get('slug') or o.get('source') or '?').rsplit('-', 1)[0]
                for line in (o.get('text') or '').splitlines():
                    if cf.is_formula(line):
                        c = per[course]; c['total'] += 1
                        eq, _ = cf.link(line, eqs)
                        if eq:
                            c['linked'] += 1; c['eqs'].add(eq['id'])
        scored = [(co, v) for co, v in per.items() if v['total'] >= MIN_FORMULAS]
        scored.sort(key=lambda kv: kv[1]['linked'] / max(kv[1]['total'], 1))   # worst recovery first
        tot_f = sum(v['total'] for _, v in scored); tot_l = sum(v['linked'] for _, v in scored)
        covered = set().union(*[v['eqs'] for _, v in scored]) if scored else set()
        print(f"\n## {field} — {len(scored)} courses · overall recovery {100*tot_l/max(tot_f,1):.1f}% "
              f"· {len(covered)}/{len(eqs)} canon equations seen across courses")
        print(f"  WORST classes (most formulas, lowest recovery — ground these first):")
        for co, v in scored[:WORST]:
            print(f"    {100*v['linked']/v['total']:4.1f}%  {v['linked']:>4}/{v['total']:<5} {co[:52]}")
    print(f"\n# per-course recovery → target the low-% high-volume classes; ground via canon(AP)+Wikidata, link clean")


if __name__ == '__main__':
    main()
