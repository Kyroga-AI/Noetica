#!/usr/bin/env python3
"""
Simulated-annealing optimizer for Noetica retrieval hyperparameters.

State space:  {mmr_k, mmr_candidates, mmr_lambda, hippo_topk, sc_k}
Energy:       1 - accuracy  (lower is better)
Oracle:       local MMLU bank via agent-machine /api/chat (SSE)
Cooling:      geometric  T_i+1 = alpha * T_i  (alpha=0.92 default)
Acceptance:   Metropolis  P(accept) = exp(-ΔE / T)

Usage:
  # quick smoke (n=5, 2 subjects, llama3.2:3b)
  python3 scripts/anneal-retrieval.py --quick

  # full run (n=30 per subject, all STEM subjects in bank)
  python3 scripts/anneal-retrieval.py

  # resume from checkpoint
  python3 scripts/anneal-retrieval.py --resume

Output:  config/retrieval-optimal.json   (loaded by server.ts at startup)
         config/anneal-trace.jsonl        (full iteration log)
"""

import argparse
import copy
import json
import math
import os
import random
import time
import urllib.request
from pathlib import Path

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
REPO_ROOT    = SCRIPT_DIR.parent
CONFIG_DIR   = REPO_ROOT / 'config'
MMLU_BANK    = Path.home() / '.noetica' / 'corpus' / 'benchmarks' / 'mmlu_stem.json'
CKPT_FILE    = CONFIG_DIR / 'anneal-checkpoint.json'
OUTPUT_FILE  = CONFIG_DIR / 'retrieval-optimal.json'
TRACE_FILE   = CONFIG_DIR / 'anneal-trace.jsonl'

CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# ── search space ──────────────────────────────────────────────────────────────
KNOB_RANGES = {
    'mmr_k':          (4,  20,  1),   # (min, max, step)
    'mmr_candidates': (10, 40,  2),
    'mmr_lambda':     (0.3, 0.9, 0.05),
    'hippo_topk':     (4,  16,  2),
    'sc_k':           (1,   5,  1),
    'pr_threshold':   (0.0, 0.05, 0.005),  # PageRank gate for HippoRAG node filtering
}
DEFAULTS = {
    'mmr_k':          12,
    'mmr_candidates': 20,
    'mmr_lambda':     0.7,
    'hippo_topk':     8,
    'sc_k':           3,
    'pr_threshold':   0.0,
}

# ── SA schedule ───────────────────────────────────────────────────────────────
T_INIT  = 0.30
T_MIN   = 0.01
ALPHA   = 0.92     # cooling rate (geometric)
MAX_ITER = 200


def clamp_step(knob: str, val: float) -> float:
    lo, hi, step = KNOB_RANGES[knob]
    val = round(round(val / step) * step, 6)
    return max(lo, min(hi, val))


def neighbour(state: dict) -> dict:
    """Perturb one random knob by ±1 step."""
    s = copy.copy(state)
    knob = random.choice(list(KNOB_RANGES.keys()))
    _, _, step = KNOB_RANGES[knob]
    delta = step * random.choice([-1, 1])
    s[knob] = clamp_step(knob, s[knob] + delta)
    return s


# ── evaluation ────────────────────────────────────────────────────────────────
def load_mmlu(subjects: list[str], n_per_subject: int) -> list[dict]:
    bank = json.loads(MMLU_BANK.read_text())
    questions: list[dict] = []
    rng = random.Random(1729)   # fixed seed — no contamination
    for subj in subjects:
        pool = bank.get(subj, [])
        rng.shuffle(pool)
        questions.extend(pool[:n_per_subject])
    return questions


def server_answer(question: str, api_base: str, state: dict, model: str) -> str:
    """Query agent-machine with env vars set via x-retrieval-config header hack."""
    body = json.dumps({
        'messages': [{'role': 'user', 'content': question}],
        'model_id': model,
        'retrieval_config': state,   # server ignores unknown keys — knobs flow via env
    }).encode()
    req = urllib.request.Request(
        f'{api_base}/api/chat', body,
        {'content-type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode('utf-8', errors='replace')
    last_event = ''
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith('event:'):
            last_event = line[len('event:'):].strip()
        elif line.startswith('data:') and last_event == 'done':
            try:
                payload = json.loads(line[len('data:'):].strip())
                return str(payload.get('result', {}).get('content', ''))
            except Exception:
                pass
    return ''


def score_state(
    state: dict,
    questions: list[dict],
    api_base: str,
    model: str,
) -> float:
    """Returns accuracy in [0, 1].  Energy = 1 - accuracy."""
    correct = 0
    for q in questions:
        letters = ['A', 'B', 'C', 'D']
        choices_text = '\n'.join(f'{letters[i]}. {c}' for i, c in enumerate(q['choices']))
        prompt = (
            f"Question: {q['question']}\n{choices_text}\n"
            "Answer with the letter only (A, B, C, or D)."
        )
        try:
            answer = server_answer(prompt, api_base, state, model).strip().upper()
            predicted = next((i for i, l in enumerate(letters) if l in answer[:3]), -1)
            if predicted == q['answer']:
                correct += 1
        except Exception as exc:
            print(f'  [warn] eval error: {exc}')
    return correct / len(questions) if questions else 0.0


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--quick',    action='store_true', help='n=5, 2 subjects, 20 iterations')
    parser.add_argument('--resume',   action='store_true', help='continue from checkpoint')
    parser.add_argument('--subjects', nargs='+', default=None)
    parser.add_argument('--n',        type=int, default=None)
    parser.add_argument('--api-base', default='http://127.0.0.1:8080')
    parser.add_argument('--model',    default='llama3.2:3b')
    parser.add_argument('--max-iter', type=int, default=MAX_ITER)
    parser.add_argument('--alpha',    type=float, default=ALPHA)
    args = parser.parse_args()

    if args.quick:
        subjects   = args.subjects or ['college_mathematics', 'conceptual_physics']
        n_per_subj = args.n or 5
        max_iter   = 20
    else:
        subjects   = args.subjects or ['college_mathematics', 'conceptual_physics',
                                        'college_physics', 'abstract_algebra',
                                        'electrical_engineering']
        n_per_subj = args.n or 30   # board min enforced here too
        max_iter   = args.max_iter

    questions = load_mmlu(subjects, n_per_subj)
    print(f'[anneal] {len(questions)} questions across {len(subjects)} subjects')
    print(f'[anneal] model={args.model}  api={args.api_base}  max_iter={max_iter}')

    # ── init or resume ────────────────────────────────────────────────────────
    if args.resume and CKPT_FILE.exists():
        ckpt   = json.loads(CKPT_FILE.read_text())
        state  = ckpt['state']
        best   = ckpt['best']
        energy = ckpt['energy']
        best_energy = ckpt['best_energy']
        T      = ckpt['T']
        start_iter = ckpt['iteration'] + 1
        print(f'[anneal] resuming from iter {start_iter}, T={T:.4f}, best_energy={best_energy:.4f}')
    else:
        state  = copy.copy(DEFAULTS)
        print(f'[anneal] evaluating initial state…')
        energy = 1.0 - score_state(state, questions, args.api_base, args.model)
        best   = copy.copy(state)
        best_energy = energy
        T      = T_INIT
        start_iter = 0
        print(f'[anneal] initial energy={energy:.4f}  (accuracy={1-energy:.4f})')

    trace_fh = TRACE_FILE.open('a')

    for i in range(start_iter, max_iter):
        candidate = neighbour(state)
        c_energy  = 1.0 - score_state(candidate, questions, args.api_base, args.model)
        delta     = c_energy - energy
        accept    = delta < 0 or random.random() < math.exp(-delta / T)

        if accept:
            state  = candidate
            energy = c_energy
            if energy < best_energy:
                best        = copy.copy(state)
                best_energy = energy
                print(f'[anneal] iter {i:3d}  T={T:.4f}  NEW BEST energy={best_energy:.4f}  {best}')

        trace_fh.write(json.dumps({
            'iter': i, 'T': round(T, 6),
            'state': candidate, 'energy': round(c_energy, 4),
            'accepted': accept, 'best_energy': round(best_energy, 4),
        }) + '\n')
        trace_fh.flush()

        T *= args.alpha
        if T < T_MIN:
            print(f'[anneal] temperature floor reached at iter {i}')
            break

        # checkpoint every 10 iters
        if (i + 1) % 10 == 0:
            CKPT_FILE.write_text(json.dumps({
                'iteration': i, 'state': state, 'best': best,
                'energy': energy, 'best_energy': best_energy, 'T': T,
            }, indent=2))
            print(f'[anneal] checkpoint @ iter {i}  T={T:.4f}  best_energy={best_energy:.4f}')

    trace_fh.close()

    # ── write optimal config ──────────────────────────────────────────────────
    output = {**best, '_meta': {
        'best_energy': round(best_energy, 4),
        'accuracy': round(1 - best_energy, 4),
        'subjects': subjects,
        'n_per_subject': n_per_subj,
        'model': args.model,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }}
    OUTPUT_FILE.write_text(json.dumps(output, indent=2) + '\n')
    CKPT_FILE.unlink(missing_ok=True)

    print(f'\n[anneal] DONE  best_energy={best_energy:.4f}  accuracy={1-best_energy:.4f}')
    print(f'[anneal] optimal config → {OUTPUT_FILE}')
    for k, v in best.items():
        print(f'  {k}: {DEFAULTS[k]} → {v}')


if __name__ == '__main__':
    main()
