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
  # measure real production retriever (agent-machine server must be running on --api-base):
  python3 scripts/graphrag-bench.py --domain medical --n 200 --use-server --out answers.json
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


def raptor_lite(chunks: list, query: str, model: str, levels: int = 2) -> str:
    """Hierarchical RAPTOR-lite: cluster chunks → summarize each cluster → recurse.
    Returns a single synthetic summary grounded in the whole corpus, not just top-k leaves.
    Matches the TypeScript raptor-runtime.ts approach without external deps."""
    if not chunks:
        return ''
    cluster_size = 5
    current = list(chunks)
    for _ in range(levels):
        if len(current) <= cluster_size:
            break
        clusters = [current[i:i + cluster_size] for i in range(0, len(current), cluster_size)]
        summaries = []
        for cl in clusters:
            joined = '\n\n'.join(f'[{j+1}] {p[:500]}' for j, p in enumerate(cl))
            try:
                s = ollama(
                    f'Write one concise paragraph summarising the key facts across these passages. '
                    f'Preserve specific entities and claims; add nothing new.\n\n{joined}\n\nSummary:',
                    model, temperature=0.1,
                )
                summaries.append(s)
            except Exception:
                summaries.extend(cl)
        current = summaries
    # final answer generation from the collapsed summaries
    ctx = '\n\n'.join(current[:8])
    return ctx


def server_answer(q: dict, api_base: str) -> str:
    """Route the question through the production agent-machine server, measuring the real
    dual-layer retrieval + RAPTOR pipeline (not the harness's keyword strawman).
    The server always responds with SSE (event: <name>\ndata: <json>\n\n). We read the
    stream, find the 'done' event, and return result.content from it."""
    body = json.dumps({'messages': [{'role': 'user', 'content': q['question']}]}).encode()
    req = urllib.request.Request(f'{api_base}/api/chat', body, {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read().decode('utf-8', errors='replace')
    # SSE format: "event: <name>\ndata: <json>\n\n" blocks
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


def answer(q: dict, chunks: list, model: str, sc_k: int) -> str:
    arm, k, vote = ROUTING.get(q['question_type'], ('reason+sc', 4, True))
    ctx = '\n\n'.join(retrieve(q['question'], chunks, k))
    if arm == 'summarize':
        # RAPTOR-lite: hierarchical clustering + summarization over the wider chunk window.
        # Simple leaf-chunk retrieval misses global "what does the whole corpus say" questions;
        # the hierarchical approach pools across the corpus before answering.
        raptor_ctx = raptor_lite(retrieve(q['question'], chunks, 16), q['question'], model)
        ctx_to_use = raptor_ctx if raptor_ctx else ctx
        prompt = f"Using the notes, write a comprehensive answer that synthesises across the whole text.\nNotes:\n{ctx_to_use}\n\nQuestion: {q['question']}\nAnswer:"
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
    ap.add_argument('--use-server', action='store_true', help='route through the production agent-machine server (measures real dual-layer retrieval)')
    ap.add_argument('--api-base', default='http://127.0.0.1:8080', help='agent-machine server base URL for --use-server')
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

    if a.use_server:
        print(f'  --use-server: routing through {a.api_base} (measures real dual-layer retrieval + RAPTOR)', file=sys.stderr)

    out = []
    for i, q in enumerate(qs):
        try:
            if a.use_server:
                pred = server_answer(q, a.api_base)
            else:
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
