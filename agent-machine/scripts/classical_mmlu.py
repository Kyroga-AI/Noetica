#!/usr/bin/env python3
"""
classical_mmlu — answer MMLU with NO LLM and NO ollama. Pure classical IR over the MIT-OCW brain.

The ollama embedding/generation pass is the entire CPU bottleneck. It vanishes if we retrieve AND
answer classically. For each multiple-choice question we PLUG IN EACH CHOICE and ask the corpus
which candidate the evidence best supports:

  TF-IDF the whole brain (per field) → for each choice, query "question + choice" → its best cosine
  to any chunk is that choice's evidence-support → pick the best-supported choice.

Deterministic, ~1000x faster than embedding each query through a 3B; runs the whole 2,328-question
bank in minutes on CPU. This is the classical, no-ollama floor — and the honest baseline the brain
has to beat.

Run:  OCW_BRAIN=... python3 scripts/classical_mmlu.py [--per N] [--subjects a,b] [--seed 1729]
"""
import os, sys, json, glob, re
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
BANK = os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')
LETTERS = 'ABCD'
PER = int(sys.argv[sys.argv.index('--per') + 1]) if '--per' in sys.argv else 0   # 0 = ALL
SEED = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 1729

SUBJECT_FIELDS = {
    'college_mathematics': ['mathematics'], 'abstract_algebra': ['mathematics'],
    'high_school_mathematics': ['mathematics'], 'high_school_statistics': ['mathematics'],
    'college_physics': ['physics'], 'conceptual_physics': ['physics'], 'high_school_physics': ['physics'],
    'astronomy': ['physics', 'earth_planetary'],
    'college_chemistry': ['chemistry'], 'high_school_chemistry': ['chemistry'],
    'college_biology': ['biology', 'biological_eng'], 'high_school_biology': ['biology', 'biological_eng'],
    'college_computer_science': ['eecs'], 'electrical_engineering': ['eecs'],
}
_CACHE = {}


def build_index(field):
    """Fit TF-IDF over every chunk in a field (1-2 grams). M is L2-normalized → cosine = dot."""
    if field in _CACHE:
        return _CACHE[field]
    texts = []
    for fp in glob.glob(os.path.join(BRAIN, field, '*.jsonl')):
        for line in open(fp, errors='replace'):
            try:
                t = json.loads(line).get('text', '')
            except Exception:
                continue
            if t and len(t) > 40:
                texts.append(t)
    if not texts:
        _CACHE[field] = None
        return None
    vec = TfidfVectorizer(stop_words='english', sublinear_tf=True, ngram_range=(1, 2),
                          max_features=80000, min_df=2)
    M = vec.fit_transform(texts)   # norm='l2' by default → rows unit-norm
    _CACHE[field] = (vec, M, len(texts))
    return _CACHE[field]


def answer(q, fields, k=15):
    """Retrieve the question's evidence, then score each CHOICE's own content against that evidence
    (not question+choice — the shared question text washes out the discriminating signal). The
    choice whose specific terms the relevant evidence most supports wins."""
    idxs = [build_index(f) for f in fields]
    idxs = [x for x in idxs if x]
    if not idxs:
        return None
    choices = q['choices']
    best = np.full(len(choices), -1.0)
    for vec, M, _n in idxs:
        qv = normalize(vec.transform([q['question']]))
        qsim = np.asarray((qv @ M.T).todense()).ravel()
        top = np.argsort(qsim)[::-1][:k]
        ev = M[top]                                  # k × vocab — the question's evidence
        Cv = normalize(vec.transform(choices))       # choices' OWN content
        sims = np.asarray((Cv @ ev.T).todense())     # choices × k → best supporting evidence chunk
        best = np.maximum(best, sims.max(axis=1))
    return LETTERS[int(np.argmax(best))]


def main():
    bank = json.load(open(BANK))
    want = None
    if '--subjects' in sys.argv:
        want = set(sys.argv[sys.argv.index('--subjects') + 1].split(','))
    ready = {d for d in os.listdir(BRAIN) if os.path.isdir(os.path.join(BRAIN, d)) and glob.glob(os.path.join(BRAIN, d, '*.jsonl'))}
    subjects = [s for s in SUBJECT_FIELDS if (not want or s in want) and any(f in ready for f in SUBJECT_FIELDS[s]) and s in bank]
    print(f"# classical_mmlu — TF-IDF over the brain, no LLM · per={PER or 'ALL'} · seed={SEED}\n")
    print(f"  {'subject':28}{'n':>5}{'classical':>11}")
    print(f"  {'─'*28}{'─'*5}{'─'*11}")
    rng = np.random.default_rng(SEED)
    gtot = gn = 0
    for subj in subjects:
        qs = bank[subj][:]
        rng.shuffle(qs)
        if PER:
            qs = qs[:PER]
        c = n = 0
        for q in qs:
            pred = answer(q, [f for f in SUBJECT_FIELDS[subj] if f in ready])
            if pred is None:
                continue
            n += 1; c += (pred == LETTERS[q['answer']])
        if n:
            print(f"  {subj:28}{n:>5}{f'{100*c/n:.1f}%':>11}")
            gtot += c; gn += n
    if gn:
        print(f"\n  {'OVERALL':28}{gn:>5}{f'{100*gtot/gn:.1f}%':>11}   ← classical, zero ollama")
    print("\n# random baseline = 25%. This is the no-LLM floor; the brain+model must beat it.")


if __name__ == '__main__':
    main()
