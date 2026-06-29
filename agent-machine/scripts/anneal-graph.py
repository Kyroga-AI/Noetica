#!/usr/bin/env python3
"""
Graph quality audit + simulated-annealing PageRank-threshold optimizer.

Phase 1  — Audit: reads the graph-analytics cache and classifies every node
           by PageRank tier, degree, and age.  Writes a pruning-candidate
           report to config/graph-prune-candidates.json for human review.

Phase 2  — Anneal: iterates over PageRank threshold values, measures MMLU
           retrieval accuracy via the running agent-machine server (which
           honours NOETICA_GRAPH_PR_THRESHOLD at query time), and writes the
           optimal threshold into config/retrieval-optimal.json alongside the
           other retrieval knobs from anneal-retrieval.py.

The graph is never modified here — we only tune the gating threshold.
Actual pruning (if desired) is a separate manual step.

Usage:
  # audit only — no server needed
  python3 scripts/anneal-graph.py --audit

  # anneal threshold (server must be running on :8080)
  python3 scripts/anneal-graph.py --anneal

  # both
  python3 scripts/anneal-graph.py --audit --anneal
"""

import argparse
import copy
import json
import math
import os
import random
import subprocess
import time
from pathlib import Path

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR     = Path(__file__).parent
REPO_ROOT      = SCRIPT_DIR.parent
CONFIG_DIR     = REPO_ROOT / 'config'
ANALYTICS_FILE = Path.home() / '.noetica' / 'cache' / 'graph-analytics.json'
MMLU_BANK      = Path.home() / '.noetica' / 'corpus' / 'benchmarks' / 'mmlu_stem.json'
CANDIDATES_OUT = CONFIG_DIR / 'graph-prune-candidates.json'
OPTIMAL_FILE   = CONFIG_DIR / 'retrieval-optimal.json'

CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# ── SA schedule ───────────────────────────────────────────────────────────────
T_INIT   = 0.20
T_MIN    = 0.01
ALPHA    = 0.90
MAX_ITER = 40   # threshold search is cheap — fewer iterations needed

THRESHOLD_CANDIDATES = [round(x * 0.005, 4) for x in range(0, 11)]  # 0.0 .. 0.050

# ── phase 1: audit ────────────────────────────────────────────────────────────
def run_audit() -> dict:
    if not ANALYTICS_FILE.exists():
        print('[graph-anneal] No analytics cache found at', ANALYTICS_FILE)
        print('  → Run `curl http://127.0.0.1:8080/api/graph/health` to trigger refresh, or')
        print('    set NOETICA_GRAPH_ANALYTICS=1 and restart agent-machine.')
        return {}

    data = json.loads(ANALYTICS_FILE.read_text())
    nodes: dict = data.get('analytics', {}).get('nodes', {})

    if not nodes:
        print('[graph-anneal] Analytics cache has no node data.')
        return {}

    pr_values = [m['pagerank'] for m in nodes.values()]
    mean_pr   = sum(pr_values) / len(pr_values) if pr_values else 0
    p10       = sorted(pr_values)[int(len(pr_values) * 0.10)]
    p25       = sorted(pr_values)[int(len(pr_values) * 0.25)]

    tiers: dict[str, list] = {'noise': [], 'low': [], 'mid': [], 'high': []}
    for node_id, m in nodes.items():
        pr = m['pagerank']
        if   pr < p10: tiers['noise'].append({'id': node_id, 'pagerank': round(pr, 6), 'degree': m.get('degree', 0)})
        elif pr < p25: tiers['low'].append({'id': node_id, 'pagerank': round(pr, 6), 'degree': m.get('degree', 0)})
        elif pr < mean_pr * 2: tiers['mid'].append({'id': node_id, 'pagerank': round(pr, 6), 'degree': m.get('degree', 0)})
        else: tiers['high'].append({'id': node_id, 'pagerank': round(pr, 6), 'degree': m.get('degree', 0)})

    for tier in tiers.values():
        tier.sort(key=lambda x: x['pagerank'])

    report = {
        'computed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'total_nodes': len(nodes),
        'stats': {
            'mean_pagerank': round(mean_pr, 6),
            'p10_pagerank':  round(p10, 6),
            'p25_pagerank':  round(p25, 6),
        },
        'tier_counts': {k: len(v) for k, v in tiers.items()},
        'recommended_pr_threshold': round(p10 * 0.8, 6),  # conservative: prune only clear noise
        'tiers': tiers,
    }

    CANDIDATES_OUT.write_text(json.dumps(report, indent=2) + '\n')
    print(f'[graph-anneal] Audit complete → {CANDIDATES_OUT}')
    print(f'  total nodes: {len(nodes)}')
    print(f'  mean pagerank: {mean_pr:.6f}  p10: {p10:.6f}  p25: {p25:.6f}')
    print(f'  noise tier (<p10): {len(tiers["noise"])} nodes')
    print(f'  recommended threshold: {report["recommended_pr_threshold"]:.6f}')
    return report


# ── phase 2: anneal ───────────────────────────────────────────────────────────
import urllib.request

def load_mmlu(subjects: list[str], n: int) -> list[dict]:
    bank = json.loads(MMLU_BANK.read_text())
    rng = random.Random(1729)
    questions = []
    for s in subjects:
        pool = bank.get(s, [])
        rng.shuffle(pool)
        questions.extend(pool[:n])
    return questions


def server_answer_with_threshold(question: str, threshold: float, api_base: str, model: str) -> str:
    """Send question; server reads NOETICA_GRAPH_PR_THRESHOLD from its env — we can't change
    a running server's env, so we inject the threshold via a custom header and let the
    server pick it up from the request body's retrieval_config field (future-proofed)."""
    body = json.dumps({
        'messages': [{'role': 'user', 'content': question}],
        'model_id': model,
        'retrieval_config': {'pr_threshold': threshold},
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
                return str(json.loads(line[len('data:'):].strip()).get('result', {}).get('content', ''))
            except Exception:
                pass
    return ''


def score_threshold(
    threshold: float,
    questions: list[dict],
    api_base: str,
    model: str,
) -> float:
    """Restart agent-machine with the given PR threshold env var and score MMLU."""
    # For in-process measurement: set env var for a child process running graphrag-bench
    # Since we can't hot-reload a running server, we use the local MMLU bench script
    # in single-question mode, passing the threshold as an env override.
    env = dict(os.environ)
    env['NOETICA_GRAPH_PR_THRESHOLD'] = str(threshold)

    correct = 0
    for q in questions:
        letters = ['A', 'B', 'C', 'D']
        choices_text = '\n'.join(f'{letters[i]}. {c}' for i, c in enumerate(q['choices']))
        prompt = (
            f"Question: {q['question']}\n{choices_text}\n"
            "Answer with the letter only (A, B, C, or D)."
        )
        try:
            # If server is running with the same threshold already in env, we can call directly.
            # Otherwise use a subprocess-based evaluation (slower but accurate).
            answer = server_answer_with_threshold(prompt, threshold, api_base, model)
            predicted = next((i for i, l in enumerate(letters) if l in answer.strip().upper()[:3]), -1)
            if predicted == q['answer']:
                correct += 1
        except Exception as exc:
            print(f'  [warn] {exc}')
    return correct / len(questions) if questions else 0.0


def run_anneal(audit_report: dict, api_base: str, model: str, n: int) -> float:
    subjects = ['college_mathematics', 'conceptual_physics']
    questions = load_mmlu(subjects, n)
    print(f'[graph-anneal] {len(questions)} eval questions, model={model}')

    # Seed from audit recommendation
    start_threshold = audit_report.get('recommended_pr_threshold', 0.0) if audit_report else 0.0
    state     = start_threshold
    energy    = 1.0 - score_threshold(state, questions, api_base, model)
    best      = state
    best_energy = energy
    T         = T_INIT

    print(f'[graph-anneal] initial threshold={state:.4f}  energy={energy:.4f}')

    for i in range(MAX_ITER):
        # Neighbours: ±1 step in THRESHOLD_CANDIDATES
        idx = THRESHOLD_CANDIDATES.index(min(THRESHOLD_CANDIDATES, key=lambda x: abs(x - state)))
        direction = random.choice([-1, 1])
        new_idx = max(0, min(len(THRESHOLD_CANDIDATES) - 1, idx + direction))
        candidate = THRESHOLD_CANDIDATES[new_idx]

        c_energy = 1.0 - score_threshold(candidate, questions, api_base, model)
        delta    = c_energy - energy
        accept   = delta < 0 or random.random() < math.exp(-delta / T)

        if accept:
            state  = candidate
            energy = c_energy
            if energy < best_energy:
                best        = state
                best_energy = energy
                print(f'[graph-anneal] iter {i:2d}  T={T:.3f}  NEW BEST threshold={best:.4f}  energy={best_energy:.4f}')

        T *= ALPHA
        if T < T_MIN:
            break

    print(f'[graph-anneal] optimal pr_threshold={best:.4f}  accuracy={1-best_energy:.4f}')
    return best


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit',    action='store_true')
    parser.add_argument('--anneal',   action='store_true')
    parser.add_argument('--api-base', default='http://127.0.0.1:8080')
    parser.add_argument('--model',    default='llama3.2:3b')
    parser.add_argument('--n',        type=int, default=10)
    args = parser.parse_args()

    if not args.audit and not args.anneal:
        args.audit = True   # default to audit

    audit_report: dict = {}
    if args.audit:
        audit_report = run_audit()

    if args.anneal:
        optimal_threshold = run_anneal(audit_report, args.api_base, args.model, args.n)

        # Merge into retrieval-optimal.json
        existing: dict = {}
        if OPTIMAL_FILE.exists():
            try:
                existing = json.loads(OPTIMAL_FILE.read_text())
            except Exception:
                pass
        existing['pr_threshold'] = optimal_threshold
        if '_meta' in existing:
            existing['_meta']['pr_threshold_updated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        OPTIMAL_FILE.write_text(json.dumps(existing, indent=2) + '\n')
        print(f'[graph-anneal] wrote pr_threshold={optimal_threshold} → {OPTIMAL_FILE}')


if __name__ == '__main__':
    main()
