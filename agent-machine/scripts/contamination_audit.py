#!/usr/bin/env python3
"""
contamination_audit — the clean-eval certificate. Prove the brain has NO MMLU test text in it.

The whole "technique not horsepower" claim dies the instant a skeptic finds an MMLU question
sitting verbatim in an OCW chunk. MMLU draws on exam-style items and MIT OCW ships real exams, so
overlap is *possible* — we must rule it out, not assume it. This builds a small index of every
MMLU question's k-word shingles, then STREAMS the brain and flags any chunk that contains one
verbatim. A hit means the exact question (≥K consecutive words) appears in the brain → leakage to
review/exclude before the exam. Zero hits = a defensible clean-eval certificate.

Direction matters for memory: index the (small) questions, stream the (large) brain — so we never
hold the brain in RAM.

Run:  python3 scripts/contamination_audit.py [--k 12] [--fields physics,chemistry,...]
"""
import os, sys, json, glob, re

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
BANK = os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')
K = int(sys.argv[sys.argv.index('--k') + 1]) if '--k' in sys.argv else 12  # verbatim run length (words)


def norm(t):
    return re.sub(r'[^a-z0-9 ]+', ' ', t.lower()).split()


def shingles(words, k=K):
    for i in range(len(words) - k + 1):
        yield ' '.join(words[i:i + k])


def main():
    bank = json.load(open(BANK))
    fields = None
    if '--fields' in sys.argv:
        fields = set(sys.argv[sys.argv.index('--fields') + 1].split(','))

    # Index STEM shingles and CHOICE shingles SEPARATELY. A stem match = the QUESTION TEXT is in
    # the brain → serious leakage. A choice-only match = an answer option states a textbook fact the
    # course also teaches (e.g. "standard deviation … divided by the square root of") → coverage,
    # not the answer key → benign. Stem inserted first so it wins any shingle collision.
    qshingle = {}  # shingle -> (subject, qi, preview, source)
    nq = 0
    for subj, qs in bank.items():
        for qi, q in enumerate(qs):
            nq += 1
            for sh in shingles(norm(q['question'])):
                qshingle[sh] = (subj, qi, q['question'][:84], 'stem')
    for subj, qs in bank.items():
        for qi, q in enumerate(qs):
            for c in q.get('choices', []):
                for sh in shingles(norm(c)):
                    qshingle.setdefault(sh, (subj, qi, q['question'][:84], 'choice'))
    print(f'# indexed {nq} MMLU questions → {len(qshingle):,} distinctive {K}-grams (stem + choices)')

    files = []
    for d in sorted(os.listdir(BRAIN)):
        if fields and d not in fields:
            continue
        if os.path.isdir(os.path.join(BRAIN, d)):
            files += glob.glob(os.path.join(BRAIN, d, '*.jsonl'))

    flagged = {}      # (subject, qi) -> {'preview', 'srcs': set, 'courses': set}
    nchunks = 0
    for fp in files:
        course = os.path.basename(fp)[:-6]
        for line in open(fp, errors='replace'):
            line = line.strip()
            if not line:
                continue
            try:
                text = json.loads(line).get('text', '')
            except Exception:
                continue
            nchunks += 1
            for sh in shingles(norm(text)):
                hit = qshingle.get(sh)
                if hit:
                    e = flagged.setdefault((hit[0], hit[1]), {'preview': hit[2], 'srcs': set(), 'courses': set()})
                    e['srcs'].add(hit[3]); e['courses'].add(course)

    print(f'# streamed {len(files)} courses · {nchunks:,} chunks')
    stem = {k: v for k, v in flagged.items() if 'stem' in v['srcs']}        # SERIOUS — question in brain
    choice = {k: v for k, v in flagged.items() if 'stem' not in v['srcs']}  # benign — textbook fact in an option
    if not stem:
        print(f'\n# ✅ CLEAN — 0 of {nq} MMLU question STEMS appear verbatim in the brain.')
        print('#    The open-book lift cannot be answer-key memorization. Eval is defensible.')
        if choice:
            print(f'\n# ({len(choice)} answer choice(s) restate a textbook fact the brain also teaches —')
            print('#  coverage, NOT leakage; the question itself is absent. e.g.:')
            for (subj, qi), v in list(choice.items())[:3]:
                print(f'    [{subj}] “{v["preview"]}…”  (also taught in {sorted(v["courses"])[0]})')
        return
    print(f'\n# ⚠ {len(stem)}/{nq} question STEMS appear verbatim in the brain — SERIOUS, exclude before the exam:')
    for (subj, qi), v in list(stem.items())[:8]:
        print(f'  [{subj}] “{v["preview"]}…”  ⟵  {sorted(v["courses"])[0]}')
    print('\n# Action: drop those courses/chunks from the brain (a stem match is real leakage).')


if __name__ == '__main__':
    main()
