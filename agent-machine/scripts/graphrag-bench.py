#!/usr/bin/env python3
"""
graphrag-bench — measure prophet-mesh on GraphRAG-Bench (medical + novel, open-ended, LLM-judged F-beta).

Honest scope: the RELEASED GraphRAG-Bench is fact-retrieval + complex-reasoning + summarization over domain
corpora (NOT the paper's math/programming subset). It's graph-RAG's home turf — our WEAKER tier — so this
harness is about MATCHING the field on retrieval+reasoning, not flexing the verified-compute moat (that's
proven separately on MMLU-STEM). It routes each question_type to the right arm:

  Fact Retrieval     -> retrieve top-k passages, answer grounded            (where we close the gap)
  Complex Reasoning  -> retrieve + CoT + self-consistency (the reason lane) (our strength)
  Contextual Summarize -> retrieve a wider window + summarize               (RAPTOR is the proper tool; placeholder here)
  Creative Generation  -> retrieve + generate

Generation is via Ollama (--model). Scoring uses GraphRAG-Bench's own claim-level answer_accuracy (LLM-judge
F-beta) for comparability — run their Evaluation/ suite on the emitted answers. The heavy measured run is
GCP-shaped; --dry-run validates routing + retrieval with NO model.

Usage:
  python3 scripts/graphrag-bench.py --domain medical --n 50 --dry-run
  python3 scripts/graphrag-bench.py --domain medical --n 200 --model qwen2.5:7b --sc-k 3 --out answers.json
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from collections import Counter

BENCH = os.path.expanduser('~/.noetica/corpus/benchmarks/graphrag-bench')
STOP = set('the a an of to in is are and or for with on at by as be this that which from we you it its their '
           'what who when where how why does do did was were has have had can will would there'.split())


def chunk_corpus(domain: str, size: int = 700) -> list:
    c = json.load(open(os.path.join(BENCH, f'{domain}_corpus.json')))
    text = c[0]['context'] if isinstance(c, list) else c.get('context', '')
    words = text.split()
    return [' '.join(words[i:i + size]) for i in range(0, len(words), size)]


def terms(s: str) -> set:
    return {w for w in re.sub(r'[^a-z0-9 ]', ' ', s.lower()).split() if len(w) > 2 and w not in STOP}


def retrieve(query: str, chunks: list, k: int = 4) -> list:
    """Lightweight BM25-ish keyword retriever (crash-safe, no embeddings)."""
    qt = terms(query)
    scored = sorted(((len(qt & terms(c)), i) for i, c in enumerate(chunks)), reverse=True)
    return [chunks[i] for s, i in scored[:k] if s > 0]


# question_type -> (arm label, retrieval breadth k, whether to self-consistency-vote)
ROUTING = {
    'Fact Retrieval':       ('retrieve',   4, False),
    'Complex Reasoning':    ('reason+sc',  4, True),
    'Contextual Summarize': ('summarize',  8, False),
    'Creative Generation':  ('generate',   4, False),
}


def ollama(prompt: str, model: str, temperature: float = 0.0, base: str = 'http://127.0.0.1:11434') -> str:
    body = json.dumps({'model': model, 'stream': False, 'temperature': temperature,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(f'{base}/v1/chat/completions', body, {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())['choices'][0]['message']['content'].strip()


def answer(q: dict, chunks: list, model: str, sc_k: int) -> str:
    arm, k, vote = ROUTING.get(q['question_type'], ('reason+sc', 4, True))
    ctx = '\n\n'.join(retrieve(q['question'], chunks, k))
    if arm == 'summarize':
        prompt = f"Using the notes, write a concise summary answering the question.\nNotes:\n{ctx}\n\nQuestion: {q['question']}\nAnswer:"
    elif arm == 'reason+sc':
        prompt = f"Use the notes and reason step by step, then give a direct final answer.\nNotes:\n{ctx}\n\nQuestion: {q['question']}\nAnswer:"
    else:
        prompt = f"Answer the question using the notes; be precise and grounded.\nNotes:\n{ctx}\n\nQuestion: {q['question']}\nAnswer:"
    if vote and sc_k > 1:
        cands = [ollama(prompt, model, 0.7) for _ in range(sc_k)]            # self-consistency over reasoning chains
        return max(cands, key=len)                                          # (proxy select; real run uses the council)
    return ollama(prompt, model, 0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--domain', choices=['medical', 'novel'], default='medical')
    ap.add_argument('--n', type=int, default=50)
    ap.add_argument('--model', default='qwen2.5:7b')
    ap.add_argument('--sc-k', type=int, default=3)
    ap.add_argument('--out', default='')
    ap.add_argument('--dry-run', action='store_true', help='validate routing + retrieval with NO model calls')
    a = ap.parse_args()

    qs = json.load(open(os.path.join(BENCH, f'{a.domain}_questions.json')))[:a.n]
    chunks = chunk_corpus(a.domain)
    print(f'{a.domain}: {len(qs)} questions, {len(chunks)} corpus chunks', file=sys.stderr)
    print('  arm routing:', dict(Counter(ROUTING.get(q['question_type'], ('?',))[0] for q in qs)), file=sys.stderr)

    if a.dry_run:
        # validate retrieval lands relevant context (does a top chunk contain the gold evidence terms?)
        hit = 0
        for q in qs:
            top = retrieve(q['question'], chunks, 4)
            ev = ' '.join(q.get('evidence', [])) if isinstance(q.get('evidence'), list) else str(q.get('evidence', ''))
            if top and (terms(ev) & terms(top[0])):
                hit += 1
        print(f'  DRY-RUN: retrieval landed evidence-overlapping context for {hit}/{len(qs)} '
              f'({100 * hit // max(1, len(qs))}%) — routing + retriever wired OK', file=sys.stderr)
        return

    out = []
    for i, q in enumerate(qs):
        try:
            pred = answer(q, chunks, a.model, a.sc_k)
        except Exception as e:
            pred = ''
            print(f'  q{i} error: {repr(e)[:80]}', file=sys.stderr)
        out.append({'id': q['id'], 'question': q['question'], 'question_type': q['question_type'],
                    'answer': pred, 'ground_truth': q['answer']})
        if (i + 1) % 10 == 0:
            print(f'  {i + 1}/{len(qs)} answered', file=sys.stderr)
    dest = a.out or f'/tmp/grb_{a.domain}_answers.json'
    json.dump(out, open(dest, 'w'), indent=2)
    print(f'wrote {dest} — score with GraphRAG-Bench Evaluation/metrics/answer_accuracy.py for a comparable F-beta',
          file=sys.stderr)


if __name__ == '__main__':
    main()
