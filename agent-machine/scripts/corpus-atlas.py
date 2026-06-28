#!/usr/bin/env python3
"""
corpus-atlas — multi-corpus concept atlas. Embed the canon concepts in several CORPUS-DISTINCT lenses
(each trained on a different corpus) and EXPLOIT THE DIFFERENCES rather than averaging them away:

  1. BAKE-OFF      per-lens SEPARATION on a curated gold of cross-domain EQUIVALENCES (positives, should be
                   close) vs POLYSEMY (negatives, same label / different concept, should be far). Measures
                   which corpus aligns our knowledge best — and where each one is blind.
  2. CORPUS-LABELED LINKS  the UNION of each lens's cross-domain links, tagged by which lens(es) found them:
                   all-lens = ROBUST; single-lens = CORPUS-SPECIFIC (sense-bearing). Multi-relational edges.
  3. SPECIALIZATION  per-concept cross-lens neighbour DIVERGENCE — high = sense-ambiguous / domain-specialized
                   (these are the concepts a general corpus can't place → where our own corpus would pay off).

Every lens embeds the SAME text ("term: definition") for a fair comparison: STATIC lenses (GloVe, Numberbatch)
average word vectors; the CONTEXTUAL lens (nomic) encodes it. So the bake-off also shows static-vs-contextual.

Run:  LENSES=glove,nomic python3 scripts/corpus-atlas.py        (add numberbatch once downloaded)
"""
import os, re, json, glob, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
LENSES = [s.strip() for s in os.environ.get('LENSES', 'glove,numberbatch,nomic').split(',') if s.strip()]
OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
RELATED = float(os.environ.get('RELATED', '0.6'))     # per-lens cross-domain link threshold (lens-relative)
TOPK = int(os.environ.get('TOPK', '3'))
_w = re.compile(r"[a-zA-Z][a-zA-Z'-]+")
norm = lambda s: re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()

# ── curated GOLD: cross-domain equivalences (+) and polysemy (−). Filtered to what's actually in the canon. ──
GOLD_POS = [('laplace transform', 'mathematics', 'computer_science'), ('gradient', 'mathematics', 'physics'),
            ('divergence', 'mathematics', 'physics'), ('eigenvalue', 'mathematics', 'physics'),
            ('entropy', 'physics', 'chemistry'), ('heat capacity', 'physics', 'chemistry'),
            ('internal energy', 'physics', 'chemistry'), ('chemical potential', 'physics', 'chemistry'),
            ('allosteric regulation', 'biology', 'chemistry'), ('glycolysis', 'biology', 'chemistry'),
            ('equipartition theorem', 'physics', 'chemistry'), ('p-value', 'high_school_statistics', 'economics')]
GOLD_NEG = [('field', 'physics', 'mathematics'), ('kernel', 'mathematics', 'computer_science'),
            ('bond', 'chemistry', 'economics'), ('ring', 'mathematics', 'chemistry'),
            ('root', 'mathematics', 'biology'), ('group', 'mathematics', 'chemistry'),
            ('cell', 'biology', 'computer_science')]


def load_concepts():
    """canon topics + glossary terms with domain + the disambiguating context text."""
    nodes, seen = [], set()
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            if t.get('topic') and (dom, norm(t['topic'])) not in seen:
                seen.add((dom, norm(t['topic'])))
                nodes.append({'domain': dom, 'kind': 'Topic', 'label': t['topic'],
                              'text': f"{t['topic']}. {', '.join(t.get('subtopics', []))}"})
            for g in t.get('glossary', []):
                term = g.get('term')
                if term and (dom, norm(term)) not in seen:
                    seen.add((dom, norm(term)))
                    nodes.append({'domain': dom, 'kind': 'GlossaryTerm', 'label': term,
                                  'text': f"{term}: {g.get('definition', '')}".strip()})
    return nodes


# ── lenses (each returns a function text -> unit vector or None) ──────────────────────────────────────────
def make_lens(name):
    if name == 'nomic':
        def emb(text):
            try:
                req = urllib.request.Request(f'{OLLAMA}/api/embeddings',
                    data=json.dumps({'model': 'nomic-embed-text', 'prompt': text}).encode(),
                    headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=30) as r:
                    v = np.asarray(json.load(r)['embedding'], float)
            except Exception:
                return None
            n = np.linalg.norm(v); return v / n if n else None
        return emb, 'web/curated-pairs (contextual)'
    if name == 'academic':                                    # OUR OWN corpus (Word2Vec over OCW)
        from gensim.models import KeyedVectors
        akv = KeyedVectors.load(os.path.expanduser('~/.noetica/vectors/ocw-academic.kv'), mmap='r')
        def emb(text):
            vs = [akv[w.lower()] for w in _w.findall(text) if w.lower() in akv]
            if not vs: return None
            v = np.mean(vs, 0); n = np.linalg.norm(v); return v / n if n else None
        return emb, 'OCW academic (ours, Word2Vec)'
    # static gensim lenses: average in-vocab word vectors of the text
    import gensim.downloader as api
    model = {'glove': 'glove-wiki-gigaword-300', 'numberbatch': 'conceptnet-numberbatch-17-06-300',
             'fasttext': 'fasttext-wiki-news-subwords-300'}[name]
    kv = api.load(model)
    corpus = {'glove': 'Wikipedia+Gigaword (news)', 'numberbatch': 'ConceptNet KG-retrofitted',
              'fasttext': 'Wikipedia+news (subword)'}[name]
    def emb(text):
        vs = []
        for w in _w.findall(text):
            wl = w.lower()
            if wl in kv: vs.append(kv[wl])
        if not vs: return None
        v = np.mean(vs, 0); n = np.linalg.norm(v); return v / n if n else None
    return emb, corpus


def main():
    nodes = load_concepts()
    idx = {(n['domain'], norm(n['label'])): i for i, n in enumerate(nodes)}
    print(f"# {len(nodes)} canon concepts · lenses={LENSES}", flush=True)

    lenses = {}
    for name in LENSES:
        try:
            emb, corpus = make_lens(name); lenses[name] = (emb, corpus)
            print(f"  lens '{name}' loaded — corpus: {corpus}", flush=True)
        except Exception as e:
            print(f"  lens '{name}' SKIPPED ({str(e)[:60]})", flush=True)
    if len(lenses) < 2:
        print("# need ≥2 lenses to compare — aborting"); return

    # embed all concepts in every lens
    V = {}                                    # name -> (N, dim) with NaN rows for OOV
    for name, (emb, _) in lenses.items():
        rows, dim = [], None
        for n in nodes:
            v = emb(n['text']); rows.append(v); dim = dim or (len(v) if v is not None else None)
        M = np.full((len(nodes), dim), np.nan)
        for i, v in enumerate(rows):
            if v is not None: M[i] = v
        V[name] = M
        cov = int(np.sum(~np.isnan(M[:, 0])))
        print(f"  '{name}': embedded {cov}/{len(nodes)} concepts", flush=True)

    def cos(name, i, j):
        a, b = V[name][i], V[name][j]
        if np.isnan(a[0]) or np.isnan(b[0]): return None
        return float(np.dot(a, b))

    # ── 1. BAKE-OFF ──────────────────────────────────────────────────────────────────────────────────────
    print("\n## 1. BAKE-OFF — separation on gold (mean cos: positives should be HIGH, negatives LOW)")
    def gold_cos(name, pairs):
        out = []
        for lbl, d1, d2 in pairs:
            i, j = idx.get((d1, norm(lbl))), idx.get((d2, norm(lbl)))
            if i is None or j is None: continue
            c = cos(name, i, j)
            if c is not None: out.append(c)
        return out
    print(f"  {'lens':12} {'corpus':30} {'pos↑':>6} {'neg↓':>6} {'sep↑':>6}  (n_pos/n_neg)")
    bake = {}
    for name, (_, corpus) in lenses.items():
        pos, neg = gold_cos(name, GOLD_POS), gold_cos(name, GOLD_NEG)
        mp, mn = (np.mean(pos) if pos else float('nan')), (np.mean(neg) if neg else float('nan'))
        sep = mp - mn
        bake[name] = sep
        print(f"  {name:12} {corpus:30} {mp:6.3f} {mn:6.3f} {sep:6.3f}  ({len(pos)}/{len(neg)})")
    best = max(bake, key=lambda k: bake[k] if bake[k] == bake[k] else -9)
    print(f"  → best separation (sense-aware alignment): '{best}'")

    # ── 2. CORPUS-LABELED LINKS ──────────────────────────────────────────────────────────────────────────
    print("\n## 2. CORPUS-LABELED LINKS — cross-domain edges, tagged by which lens(es) found them")
    doms = np.array([n['domain'] for n in nodes])
    edges = {}                                 # frozenset(i,j) -> {lenses:set, cos:{}}
    for name in lenses:
        M = V[name]; ok = ~np.isnan(M[:, 0])
        S = np.where(ok[:, None] & ok[None, :], M @ np.nan_to_num(M).T, -9)
        for i in range(len(nodes)):
            if not ok[i]: continue
            order = np.argsort(-S[i]); added = 0
            for j in order:
                if j == i or doms[j] == doms[i] or not ok[j]: continue
                c = float(S[i, j])
                if c < RELATED: break
                k = frozenset((i, j))
                e = edges.setdefault(k, {'lenses': set(), 'cos': {}})
                e['lenses'].add(name); e['cos'][name] = round(c, 3)
                added += 1
                if added >= TOPK: break
    robust = [k for k, e in edges.items() if len(e['lenses']) == len(lenses)]
    specific = [k for k, e in edges.items() if len(e['lenses']) == 1]
    print(f"  {len(edges)} cross-domain edges · {len(robust)} ROBUST (all lenses) · {len(specific)} corpus-SPECIFIC (one lens)")
    print("  robust (all lenses agree — universal):")
    for k in sorted(robust, key=lambda k: -np.mean(list(edges[k]['cos'].values())))[:6]:
        i, j = tuple(k); print(f"    {nodes[i]['domain']}:{nodes[i]['label']} ⇄ {nodes[j]['domain']}:{nodes[j]['label']}  {edges[k]['cos']}")
    print("  corpus-specific (one lens only — sense-bearing):")
    shown = 0
    for k, e in edges.items():
        if len(e['lenses']) == 1:
            ln = next(iter(e['lenses'])); i, j = tuple(k)
            print(f"    [{ln}] {nodes[i]['domain']}:{nodes[i]['label']} ⇄ {nodes[j]['domain']}:{nodes[j]['label']}  {e['cos'][ln]}")
            shown += 1
            if shown >= 8: break

    # ── 3. SPECIALIZATION (cross-lens neighbour divergence) ──────────────────────────────────────────────
    print("\n## 3. SPECIALIZATION — concepts whose nearest cross-domain neighbour DIFFERS across lenses")
    div = []
    for i in range(len(nodes)):
        nbrs = {}
        for name in lenses:
            M = V[name]
            if np.isnan(M[i, 0]): continue
            ok = ~np.isnan(M[:, 0]); s = np.where(ok, M @ np.nan_to_num(M[i]), -9); s[i] = -9
            for j in range(len(nodes)):
                if doms[j] == doms[i]: s[j] = -9
            jbest = int(np.argmax(s))
            if s[jbest] > 0.3: nbrs[name] = norm(nodes[jbest]['label'])
        distinct = len(set(nbrs.values()))
        if len(nbrs) >= 2 and distinct >= 2:
            div.append((distinct, nodes[i]['domain'], nodes[i]['label'], nbrs))
    div.sort(reverse=True)
    print(f"  {len(div)} concepts disagree across lenses on their nearest cross-domain neighbour (sense-ambiguous / specialized):")
    for d, dom, lbl, nbrs in div[:10]:
        print(f"    {dom}:{lbl} → " + ' | '.join(f'{n}:{v}' for n, v in nbrs.items()))

    # write the multi-relational edge set
    out = {'lenses': {n: c for n, (_, c) in lenses.items()}, 'bakeoff_separation': bake,
           'edges': [{'a': f"{nodes[min(k)]['domain']}:{nodes[min(k)]['label']}",
                      'b': f"{nodes[max(k)]['domain']}:{nodes[max(k)]['label']}",
                      'lenses': sorted(e['lenses']), 'cos': e['cos'],
                      'kind': 'robust' if len(e['lenses']) == len(lenses) else ('specific' if len(e['lenses']) == 1 else 'partial')}
                     for k, e in edges.items()]}
    json.dump(out, open(os.path.join(CANON, 'corpus-atlas.json'), 'w'), indent=1)
    print(f"\n# wrote canon/corpus-atlas.json ({len(edges)} corpus-labeled edges)")


if __name__ == '__main__':
    main()
