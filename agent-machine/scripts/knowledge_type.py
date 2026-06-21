#!/usr/bin/env python3
"""
knowledge_type — classify questions by the 7 ARC knowledge types (Boratko et al. 2018,
"A Systematic Classification of Knowledge, Reasoning, and Context within the ARC Dataset").

Each type routes to the SOLVER it depends on — this is the question-type router that sits
beside the domain router (domain = what field; knowledge-type = what kind → which method):

  Definition / BasicFacts / Purpose  → golden RETRIEVAL (lookup)
  Causes & Processes                 → the multi-hop CHAINER
  Algebraic                          → the VERIFIED-COMPUTE engine
  Experiments                        → experimental reasoning (to build)
  Physical Model                     → spatial/kinematic reasoning (to build)

Multi-label (the paper finds ~1.4 types/question). Cheap rule-based v0 off the type
definitions; swap a trained head in later. Run over the MMLU bank to see the type mix.

Run:  python3 scripts/knowledge_type.py
"""
import os, re, json
from collections import Counter

UNIT = re.compile(r'\d\s*(m/s|kg|mol|N\b|J\b|W\b|V\b|A\b|Hz|cm|mm|km|°|K\b|Pa|ohm|Ω|g\b|L\b|eV|nm|watt|volt|joule|gram|meter|second)', re.I)
NUM = re.compile(r'\b\d+(\.\d+)?\b')

# type -> (solver, signal patterns)
TYPES = {
    'Definition':       ('retrieve', [r'\bis called\b', r'\bterm for\b', r'\bdefined as\b', r'\bthe name (for|of)\b',
                                       r'\bbest describes\b', r'\bdefinition of\b', r'\brefers to\b']),
    'BasicFacts':       ('retrieve', [r'\bhow many\b', r'\bwhich (of the )?(following )?(element|compound|gas|metal|organ|planet|part)\b',
                                       r'\bwhat (is|are) the\b', r'\bmade (up )?of\b', r'\bconsists? of\b']),
    'CausesProcesses':  ('chain',    [r'\bfirst step\b', r'\bprocess\b', r'\bsequence\b', r'\bstages?\b', r'\bcycle\b',
                                       r'\bwhat happens (when|after|next|if)\b', r'\bin order\b', r'\bsteps?\b',
                                       r'\bleads? to\b', r'\bresults? in\b', r'\bcauses?\b']),
    'Purpose':          ('retrieve', [r'\bfunction of\b', r'\bpurpose of\b', r'\brole of\b', r'\bused (to|for)\b',
                                       r'\bwhy (do|does|are|is)\b', r'\bin order to\b', r'\bhelps? (to )?\b']),
    'Algebraic':        ('compute',  [r'\bcalculate\b', r'\bhow much\b', r'\bhow far\b', r'\bhow fast\b', r'\bhow long\b',
                                       r'\bwhat is the (value|magnitude|force|velocity|energy|current|mass|speed|frequency|resistance|acceleration|momentum|pressure|power|charge|wavelength|volume|density|work)\b',
                                       r'=', r'\bsolve\b', r'\bequation\b']),
    'Experiments':      ('experiment', [r'\bexperiment', r'\bhypothes', r'\bcontrol(led| group| variable)?\b', r'\bindependent variable\b',
                                        r'\bscientists?\b', r'\bmeasure(ment)?\b', r'\bobserv', r'\btest(ed|ing)?\b', r'\bdata\b', r'\btrial\b']),
    'PhysicalModel':    ('spatial', [r'\bmoves?\b', r'\bmoving\b', r'\bcollid', r'\bdirection\b', r'\bdistance\b', r'\bpath\b',
                                     r'\bwhat (most likely )?happens when\b', r'\bair mass\b', r'\borbit', r'\bgravit', r'\bfriction\b']),
}


def classify(q):
    text = q.lower()
    hits = []
    for t, (_solver, sigs) in TYPES.items():
        if any(re.search(s, text) for s in sigs):
            hits.append(t)
    if 'Algebraic' not in hits and (UNIT.search(q) or (re.search(r'\bwhat is the\b', text) and NUM.search(q))):
        hits.append('Algebraic')
    return hits or ['BasicFacts']   # default to a factual lookup


def main():
    bank = json.load(open(os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')))
    type_count = Counter(); solver_count = Counter(); n = 0; multi = 0
    by_subject = {}
    for subj, items in bank.items():
        sc = Counter()
        for it in items:
            n += 1
            types = classify(it['question'])
            if len(types) > 1:
                multi += 1
            for t in types:
                type_count[t] += 1; sc[t] += 1
                solver_count[TYPES[t][0]] += 1
        by_subject[subj] = sc

    print(f"# knowledge-type classification — {n} MMLU questions · {multi/n:.0%} multi-label "
          f"(paper: ~1.4 types/q)\n")
    print("  KNOWLEDGE TYPE      questions   share   → solver")
    print("  " + "-"*54)
    for t, c in type_count.most_common():
        print(f"  {t:18} {c:>7}   {100*c//n:>4}%   → {TYPES[t][0]}")
    print(f"\n  SOLVER ROUTING (where the type-router sends each question):")
    for s, c in solver_count.most_common():
        print(f"    {s:12} {c:>6}  ({100*c//sum(solver_count.values()):>2}%)")
    print(f"\n  by subject (dominant knowledge type):")
    for subj, sc in by_subject.items():
        top = sc.most_common(1)[0] if sc else ('-', 0)
        print(f"    {subj:26} {top[0]} ({100*top[1]//len(bank[subj])}%)")


if __name__ == '__main__':
    main()
