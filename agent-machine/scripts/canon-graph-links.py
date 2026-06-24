#!/usr/bin/env python3
"""
canon-graph-links — turn the canon TREE (domain→topic→term) into a real GRAPH by adding CROSS-DOMAIN
links between concepts near in embedding space. This is cross-domain ONTOLOGY ALIGNMENT, so it must be
SENSE-AWARE: plain word vectors conflate senses ("field" EM / algebraic / DB → one vector), which produces
false alignments. Following the sense-embedding / refined-vector alignment literature (SensEmbed, NASARI,
LMMS; DeepAlignment, OWL2Vec*), we disambiguate the sense BEFORE aligning — here using the glossary
DEFINITION as the disambiguating context and a CONTEXTUAL encoder (nomic), so "field: region where a force
acts" and "field: a set with two operations…" get different vectors and do NOT fuse.

Two spaces, kept distinct: GloVe (static) = the topic-label MAP (canon-keyvec-align.py); nomic (contextual)
= this sense-aware concept space (also a down-payment on vectorizing the canon as the nomic brain, T1).

Same-domain pairs are skipped (already tree-linked). `same_as` requires a HIGH contextual cosine (sense
agreement), NOT mere label match — that's the whole point. Node ids match scripts/canon-to-graph.ts.

Output: canon/cross-domain-links.json  (the TS ingest adds related/same_as edges).
Run:  EMBED=nomic python3 scripts/canon-graph-links.py     (EMBED=glove falls back to static, label-only)
"""
import os, re, json, glob, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
EMBED = os.environ.get('EMBED', 'nomic')
OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
TOPK = int(os.environ.get('TOPK', '3'))
# nomic cosines run higher than GloVe; thresholds tuned per-encoder (override via env)
RELATED = float(os.environ.get('RELATED', '0.78' if EMBED == 'nomic' else '0.72'))
SAME = float(os.environ.get('SAME', '0.90' if EMBED == 'nomic' else '0.95'))
_w = re.compile(r"[a-zA-Z][a-zA-Z'-]+")


def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', (s or '').lower())
    return re.sub(r'^-+|-+$', '', s)[:60]


def nomic_embed(text):
    req = urllib.request.Request(f'{OLLAMA}/api/embeddings',
        data=json.dumps({'model': 'nomic-embed-text', 'prompt': text}).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            v = np.asarray(json.load(r)['embedding'], float)
    except Exception:
        return None
    n = np.linalg.norm(v)
    return v / n if n > 0 else None


def main():
    # ── collect canon concept nodes WITH disambiguating context (definition / subtopics) ────────────────────
    nodes = []   # {id, domain, kind, label, ctx}
    seen = set()
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            if t.get('topic'):
                nid = f"canon:topic:{slug(dom)}:{slug(t['topic'])}"
                if nid not in seen:
                    seen.add(nid)
                    ctx = f"{t['topic']}. {', '.join(t.get('subtopics', []))}"
                    nodes.append({'id': nid, 'domain': dom, 'kind': 'Topic', 'label': t['topic'], 'ctx': ctx})
            for gl in t.get('glossary', []):
                term = gl.get('term')
                if not term:
                    continue
                nid = f"canon:term:{slug(dom)}:{slug(term)}"
                if nid not in seen:
                    seen.add(nid)
                    ctx = f"{term}: {gl.get('definition', '')}".strip()   # definition = the sense disambiguator
                    nodes.append({'id': nid, 'domain': dom, 'kind': 'GlossaryTerm', 'label': term, 'ctx': ctx})

    # ── embed (sense-aware contextual by default) ───────────────────────────────────────────────────────────
    if EMBED == 'glove':
        import gensim.downloader as api
        kv = api.load(os.environ.get('MODEL', 'glove-wiki-gigaword-300'))
        def emb(n):
            vs = [kv[w.lower()] for w in _w.findall(n['label']) if w.lower() in kv]   # label-only (sense-blind)
            if not vs: return None
            v = np.mean(vs, 0); nn = np.linalg.norm(v); return v / nn if nn else None
    else:
        def emb(n):
            return nomic_embed(n['ctx'])                                              # label + definition (sense-aware)

    print(f"# encoder={EMBED} · embedding {len(nodes)} canon concepts (sense context = definition/subtopics) ...", flush=True)
    vecs, kept = [], []
    for i, n in enumerate(nodes):
        v = emb(n)
        if v is not None:
            vecs.append(v); kept.append(n)
        if EMBED == 'nomic' and (i + 1) % 200 == 0:
            print(f"  embedded {i+1}/{len(nodes)}", flush=True)
    M = np.vstack(vecs); N = len(kept)
    print(f"# {N} embedded · cross-domain top-{TOPK} @ related≥{RELATED} same_as≥{SAME}", flush=True)

    sims = M @ M.T
    doms = np.array([n['domain'] for n in kept])
    labels = [n['label'].strip().lower() for n in kept]

    links = {}
    for i in range(N):
        order = np.argsort(-sims[i]); added = 0
        for j in order:
            if j == i or doms[j] == doms[i]:
                continue
            c = float(sims[i, j])
            if c < RELATED:
                break
            rel = 'same_as' if c >= SAME else 'related'     # sense-resolved cosine, NOT label match
            key = frozenset((kept[i]['id'], kept[j]['id']))
            rec = links.get(key)
            if not rec or c > rec['cos']:
                links[key] = {'from_id': kept[i]['id'], 'to_id': kept[j]['id'],
                              'from': f"{kept[i]['domain']}:{kept[i]['label']}",
                              'to': f"{kept[j]['domain']}:{kept[j]['label']}",
                              'cos': round(c, 3), 'rel': rel, 'same_label': labels[i] == labels[j]}
            added += 1
            if added >= TOPK:
                break

    out = sorted(links.values(), key=lambda r: -r['cos'])
    json.dump({'encoder': EMBED, 'related_threshold': RELATED, 'same_threshold': SAME, 'links': out},
              open(os.path.join(CANON, 'cross-domain-links.json'), 'w'), indent=1)

    same = sum(1 for r in out if r['rel'] == 'same_as')
    print(f"\n# {len(out)} cross-domain links ({same} same_as, {len(out)-same} related)")
    print("## strongest interdisciplinary links:")
    for r in out[:14]:
        print(f"  {r['cos']:.3f} {r['rel']:8} {r['from']}  ⇄  {r['to']}")
    # the sense-disambiguation check: same-label cross-domain pairs and how they scored
    sl = [r for r in out if r['same_label']]
    print(f"\n## same-LABEL cross-domain pairs ({len(sl)}) — sense check (low cos / 'related' = senses kept apart):")
    for r in sl[:10]:
        print(f"  {r['cos']:.3f} {r['rel']:8} {r['from']}  ⇄  {r['to']}")
    print(f"\n# wrote canon/cross-domain-links.json")


if __name__ == '__main__':
    main()
