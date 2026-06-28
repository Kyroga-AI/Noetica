#!/usr/bin/env python3
"""verified_compute_coverage — Metric 5 (the honesty gate). The verified-compute claim is NOT "our numbers are
right"; it is "certified-correct on C% of numeric answers, with the verification method (sympy + dimensional
homogeneity + plug-back) published." This measures C and the certified-correct rate on the covered subset, and
counts the certified-but-wrong escapes (a dimensionally-consistent wrong formula on correct inputs passes the
gate — the known, bounded gap we report rather than hide).

It feeds MMLU questions to the real compute arm (scripts/compute_arm.py --batch) and reads its fire/abstain
decision per question. Coverage is reported over the NUMERIC denominator (questions whose answer is a quantity —
the subset the claim is about) and, for context, over all questions.

  python3 scripts/verified_compute_coverage.py                         # 40/subject, numeric-heavy subjects
  N_PER=30 SUBJECTS=college_physics,college_chemistry python3 scripts/verified_compute_coverage.py
"""
import os, re, json, subprocess, hashlib, time, sys
from collections import defaultdict

BANK = os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')
N_PER = int(os.environ.get('N_PER', '40'))
SEED = int(os.environ.get('VC_SEED', '1729'))
OUT = os.path.join(os.path.dirname(__file__), '..', 'canon', 'provenance-eval')
# numeric-heavy subjects by default (where "numeric answer" is the common case); override with SUBJECTS=...
DEFAULT_SUBJECTS = ['college_physics', 'conceptual_physics', 'high_school_physics', 'college_chemistry',
                    'high_school_chemistry', 'college_mathematics', 'high_school_mathematics',
                    'high_school_statistics', 'electrical_engineering', 'astronomy']
SUBJECTS = [s for s in os.environ.get('SUBJECTS', ','.join(DEFAULT_SUBJECTS)).split(',') if s]

NUM = re.compile(r'\d')
def is_numeric_choice(c):
    """A choice is a numeric/quantity answer: has a digit and isn't dominated by prose (short unit text OK)."""
    if not NUM.search(c):
        return False
    letters = len(re.findall(r'[a-zA-Z]', c))
    return letters <= 8        # allow units like 'm/s^2', 'kg', 'mol/L', 'eV' — reject prose choices

def is_numeric_q(choices):
    return sum(is_numeric_choice(c) for c in choices) >= 3   # ≥3 of 4 choices numeric ⇒ a numeric question

def main():
    import random
    random.seed(SEED)
    bank = json.load(open(BANK))
    subjects = [s for s in SUBJECTS if s in bank] or list(bank.keys())

    items = []     # (id, subject, question, choices, gold_letter, numeric?)
    for s in subjects:
        qs = bank[s]
        if len(qs) > N_PER:
            qs = random.sample(qs, N_PER)
        for i, q in enumerate(qs):
            gi = q['answer'] if isinstance(q['answer'], int) else 'ABCD'.find(str(q['answer']).strip()[:1].upper())
            gold = 'ABCD'[gi] if 0 <= gi < 4 else None
            items.append((f'{s}:{i}', s, q['question'], q['choices'], gold, is_numeric_q(q['choices'])))

    numeric = [it for it in items if it[5]]
    print(f"# verified-compute coverage — {len(items)} questions over {len(subjects)} subjects; "
          f"{len(numeric)} numeric ({len(numeric)/len(items)*100:.0f}%)", flush=True)

    # feed the compute arm (its own fire/abstain gate decides coverage)
    payload = '\n'.join(json.dumps({'id': it[0], 'question': it[2], 'choices': it[3]}) for it in items)
    env = {**os.environ, 'OBJC_DISABLE_INITIALIZE_FORK_SAFETY': 'YES'}
    env.setdefault('MMLU_COMPUTE_LLM_TIMEOUT', '20')
    t0 = time.time()
    print(f"# running compute_arm --batch on {len(items)} questions (LLM extraction; this takes a few min)…", flush=True)
    proc = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'compute_arm.py'), '--batch'],
                          input=payload, capture_output=True, text=True, env=env, timeout=3600)
    out = {}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line); out[r['id']] = r
        except Exception:
            pass
    print(f"# compute_arm returned {len(out)}/{len(items)} in {time.time()-t0:.0f}s", flush=True)

    # tally: fire = the arm produced an answer (passed its sympy/dimensional gate); else abstain/timeout
    def tally(subset):
        fired = correct = wrong = 0
        for it in subset:
            r = out.get(it[0], {})
            ans, mode = r.get('answer'), r.get('mode', 'abstain')
            if ans and mode not in ('abstain', 'timeout', 'error'):
                fired += 1
                if it[4] and ans == it[4]:
                    correct += 1
                else:
                    wrong += 1
        return fired, correct, wrong

    f_all, c_all, w_all = tally(items)
    f_num, c_num, w_num = tally(numeric)
    cov_num = f_num / len(numeric) if numeric else 0.0
    cov_all = f_all / len(items) if items else 0.0
    ccr_num = c_num / f_num if f_num else 0.0      # certified-correct rate on covered (numeric)
    ccr_all = c_all / f_all if f_all else 0.0

    print("\n" + "=" * 66)
    print("METRIC 5 — VERIFIED-COMPUTE COVERAGE (the honesty gate)")
    print("=" * 66)
    print(f"\nNUMERIC denominator ({len(numeric)} questions — the subset the claim is about):")
    print(f"  coverage           = {cov_num:.3f}  ({f_num}/{len(numeric)} dared an answer via the sympy gate)")
    print(f"  certified-correct  = {ccr_num:.3f}  ({c_num}/{f_num} of covered match gold)")
    print(f"  certified-but-WRONG (escapes) = {w_num}  (dimensionally-consistent wrong formula slips the gate)")
    print(f"\nALL questions ({len(items)}) — context:")
    print(f"  coverage = {cov_all:.3f} ({f_all}/{len(items)})   certified-correct = {ccr_all:.3f} ({c_all}/{f_all})")
    print(f"\nHONEST CLAIM STRING:")
    print(f'  "certified-correct on {cov_num*100:.0f}% of numeric answers (the subset reducible to verifiable')
    print(f'   computation); on that covered subset {ccr_num*100:.0f}% match gold; method (sympy + dimensional')
    print(f'   homogeneity + plug-back) published; {w_num} certified-but-wrong escape(s) observed, see spot-check."')

    os.makedirs(OUT, exist_ok=True)
    try:
        rev = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True,
                             cwd=os.path.dirname(__file__)).stdout.strip()
    except Exception:
        rev = 'unknown'
    res = {'git_rev': rev, 'seed': SEED, 'n_per': N_PER, 'subjects': subjects,
           'bank_sha256_16': hashlib.sha256(open(BANK, 'rb').read()).hexdigest()[:16],
           'n_all': len(items), 'n_numeric': len(numeric),
           'numeric': {'coverage': cov_num, 'certified_correct_rate': ccr_num,
                       'fired': f_num, 'correct': c_num, 'certified_but_wrong': w_num},
           'all': {'coverage': cov_all, 'certified_correct_rate': ccr_all,
                   'fired': f_all, 'correct': c_all, 'certified_but_wrong': w_all}}
    with open(os.path.join(OUT, 'verified-compute-coverage.json'), 'w') as f:
        json.dump(res, f, indent=2)
    print(f"\n# → {os.path.join(OUT, 'verified-compute-coverage.json')}  (git {rev[:8]})")

if __name__ == '__main__':
    main()
