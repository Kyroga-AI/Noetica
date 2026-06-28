#!/usr/bin/env python3
"""
induce-prereq-dag — CAUSAL / PREREQUISITE induction (Hassanzadeh et al., IBM — causal knowledge extraction).
#3 of the IBM-5. Induces a learning-ORDER DAG over the canon: for each domain, the model proposes
`requires(A, B)` prerequisite edges between topics; we then enforce a DAG (break cycles, level-aware), and
topologically sort it into a walkable learning path.

Where it fits the product:
  • the REGISTRAR (build-registrar.py) — degree sequencing that's actually a valid prerequisite order
  • the AI tutor — "what must I learn before X?" / "what's next?" is a graph walk, not a guess
  • the HellGraph — REQUIRES edges between Topic nodes (kvClass-labelled), explorable
  • a future board arm — on a hard question, scaffold with the PREREQUISITE concepts of its topic

Method: one LLM call per domain (topics are ~15/domain) proposing edges, with the canon topic `level`
(introductory < intermediate < advanced) as a prior + the cycle-breaker. Output: canon/prereq-dag.json.
Run:  OLLAMA_MODEL=qwen2.5:7b-cpu python3 scripts/induce-prereq-dag.py   (frontier model for the real pass)
"""
import os, re, json, glob, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b-cpu')
DOMAINS = [d for d in (os.environ.get('DOMAINS') or '').split(',') if d] or None   # None = all
LEVEL_RANK = {'introductory': 0, 'intro': 0, 'foundational': 0, 'beginner': 0, 'k12': 0, 'high school': 0,
              'undergrad': 1, 'undergraduate': 1, 'intermediate': 1, 'core': 1,
              'advanced': 2, 'upper': 2, 'grad': 3, 'graduate': 3, 'doctoral': 3}
norm = lambda s: re.sub(r'\s+', ' ', (s or '').strip().lower())


def gen(prompt):
    req = urllib.request.Request(f'{OLLAMA}/api/generate',
        data=json.dumps({'model': MODEL, 'prompt': prompt, 'stream': False, 'options': {'temperature': 0}}).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r).get('response', '')
    except Exception:
        return ''


def lrank(level):
    return LEVEL_RANK.get(norm(level), 1)


def break_cycles(nodes, edges, level_of):
    """Keep a DAG. An edge A->B means 'A requires B' (B before A). Drop any edge that contradicts the
    level prior (a higher-level topic can't be a prerequisite of a lower-level one); then drop edges that
    still close a cycle, lowest-confidence (level-violating, else longest jump) first."""
    # 1. level filter: A requires B only if level(B) <= level(A)
    kept = [(a, b) for (a, b) in edges if level_of[b] <= level_of[a]]
    # 2. greedy acyclicity: add edges by ascending level-gap; skip any that would create a cycle
    adj = defaultdict(set)

    def reaches(src, dst):                       # is dst already reachable from src? (would-be cycle)
        seen, st = set(), [src]
        while st:
            x = st.pop()
            if x == dst:
                return True
            for y in adj[x]:
                if y not in seen:
                    seen.add(y); st.append(y)
        return False

    final, dropped = [], 0
    for a, b in sorted(kept, key=lambda e: abs(level_of[e[0]] - level_of[e[1]])):
        if a == b or reaches(b, a):              # b->...->a exists, adding a->b closes a cycle
            dropped += 1; continue
        adj[a].add(b); final.append((a, b))
    return final, dropped


def topo(nodes, edges, level_of):
    """Kahn topological sort. Edge A->B = A requires B, so B must come FIRST → emit a node once everything it
    requires is emitted. Tiebreak among ready nodes by (level, name) so the path stays level-coherent even
    when the LLM proposes sparse edges (advanced roots don't float to the front just by being alphabetical)."""
    needs = defaultdict(set)                       # node -> set it requires (must precede it)
    for a, b in edges:
        needs[a].add(b)
    indeg = {n: len(needs[n]) for n in nodes}
    provides = defaultdict(set)                    # b -> nodes that require b
    for a, b in edges:
        provides[b].add(a)
    key = lambda n: (level_of.get(n, 1), n)
    ready = sorted([n for n in nodes if indeg[n] == 0], key=key)
    order = []
    while ready:
        n = ready.pop(0); order.append(n)
        for m in sorted(provides[n]):
            indeg[m] -= 1
            if indeg[m] == 0:
                ready.append(m)
        ready.sort(key=key)
    return order if len(order) == len(nodes) else order + [n for n in nodes if n not in order]


def main():
    out = {}
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        if DOMAINS and dom not in DOMAINS:
            continue
        topics = [t for t in spec.get('topics', []) if t.get('topic')]
        if len(topics) < 2:
            continue
        names = [t['topic'] for t in topics]
        level_of = {t['topic']: lrank(t.get('level')) for t in topics}
        listing = '\n'.join(f"- {t['topic']}" + (f"  (level: {t.get('level')})" if t.get('level') else '') for t in topics)
        raw = gen(f"These are the topics of a {dom} curriculum:\n{listing}\n\n"
                  f"For learning ORDER, output prerequisite edges as lines `A => B` meaning \"you must learn B "
                  f"before A\" (A requires B). Only real prerequisites, one per line, topic names exactly as above. "
                  f"No prose.")
        edges = []
        byname = {norm(n): n for n in names}
        for line in raw.splitlines():
            m = re.split(r'=>|->|\brequires\b|:', line, maxsplit=1)
            if len(m) != 2:
                continue
            a, b = byname.get(norm(m[0].lstrip('- '))), byname.get(norm(m[1]))
            if a and b and a != b:
                edges.append((a, b))
        edges = list(dict.fromkeys(edges))                  # dedupe, keep order
        dag, dropped = break_cycles(names, edges, level_of)
        order = topo(names, dag, level_of)
        out[dom] = {'topics': names, 'edges': [[a, b] for a, b in dag],
                    'cycles_broken': dropped, 'proposed': len(edges), 'learning_path': order}
        print(f"# {dom:14} topics={len(names):2} · proposed={len(edges):2} · DAG-edges={len(dag):2} · broke {dropped} cycle-edges")
        print(f"    path: {' → '.join(order[:6])}{' → …' if len(order) > 6 else ''}")

    op = os.path.join(CANON, 'prereq-dag.json')
    json.dump(out, open(op, 'w'), indent=1)
    tot_e = sum(len(v['edges']) for v in out.values())
    print(f"\n# wrote {op}  ({len(out)} domains · {tot_e} prerequisite edges)")
    print("# next: build-registrar consumes learning_path for degree sequencing · canon-to-graph emits REQUIRES edges · sync-knowledge gates it")


if __name__ == '__main__':
    main()
