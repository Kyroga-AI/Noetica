#!/usr/bin/env python3
"""
induce-canon-kg — KGI / KnowGL-style knowledge-graph INDUCTION (Glass & Gliozzo, IBM). The strategic scale
move: instead of hand-authoring the canon, GENERATE typed (subject, relation, object) triples between
canonical concepts from corpus/canon text, LINK the entities to the canon vocabulary, and emit them for the
SHACL gate → HellGraph. Our edge over IBM's distant-supervision era: a FRONTIER model does the generation
(LLM=frontier), and ontogenesis SHACL-gates the result — cleaner inputs, harder gate.

Pipeline:  text → LLM triple generation → entity-link to canon → typed edges → (sync-knowledge → SHACL → graph)
Relations: is_a, part_of, requires (prerequisite), causes, computed_by, measured_by, related_to, applies_to.

Output: canon/induced-kg.jsonl ({s, r, o, s_canon, o_canon, source}). Then `sync-knowledge` ingests + gates.
Run:  SAMPLE=12 OLLAMA_MODEL=qwen2.5:7b-cpu python3 scripts/induce-canon-kg.py   (scaffold; frontier for scale)
"""
import os, re, json, glob, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b-cpu')
SAMPLE = int(os.environ.get('SAMPLE', '12'))
RELS = ['is_a', 'part_of', 'requires', 'causes', 'computed_by', 'measured_by', 'related_to', 'applies_to']
norm = lambda s: re.sub(r'[^a-z0-9 ]+', '', (s or '').lower()).strip()


def gen(prompt):
    req = urllib.request.Request(f'{OLLAMA}/api/generate',
        data=json.dumps({'model': MODEL, 'prompt': prompt, 'stream': False, 'options': {'temperature': 0}}).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r).get('response', '')
    except Exception as e:
        return ''


def main():
    # canon vocabulary (the entities to link to) + sample texts (glossary defs = clean, dense seed)
    vocab = {}                      # normalized term -> (canonical term, domain)
    texts = []                     # (text, source)
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            for g in t.get('glossary', []):
                term, d = g.get('term'), g.get('definition')
                if term:
                    vocab[norm(term)] = (term, dom)
                if term and d:
                    texts.append((f"{term}: {d}", f"{dom}:{t.get('topic')}"))
    print(f"# canon vocab {len(vocab)} terms · {len(texts)} candidate texts · model={MODEL}", flush=True)

    def link(ent):                 # entity-resolution to the canon (exact → containment)
        n = norm(ent)
        if n in vocab:
            return vocab[n][0]
        for k, (term, _) in vocab.items():
            if (n and k) and (n in k or k in n) and abs(len(n) - len(k)) <= 4:
                return term
        return None

    import random
    random.seed(1729); random.shuffle(texts)
    out, linked = [], 0
    for text, src in texts[:SAMPLE]:
        prompt = (f"Extract knowledge-graph triples from the text. Use ONLY these relations: {', '.join(RELS)}.\n"
                  f"Output one JSON object per line: {{\"s\":\"<concept>\",\"r\":\"<relation>\",\"o\":\"<concept>\"}}. "
                  f"Concepts must be real technical terms. No prose.\n\nText: {text}\n\nTriples:")
        for line in gen(prompt).splitlines():
            m = re.search(r'\{.*\}', line)
            if not m:
                continue
            try:
                tr = json.loads(m.group(0))
            except Exception:
                continue
            s, r, o = tr.get('s'), tr.get('r'), tr.get('o')
            if not (s and r and o) or r not in RELS:
                continue
            sc, oc = link(s), link(o)
            out.append({'s': s, 'r': r, 'o': o, 's_canon': sc, 'o_canon': oc, 'source': src})
            if sc or oc:
                linked += 1
    op = os.path.join(CANON, 'induced-kg.jsonl')
    with open(op, 'w') as fh:
        for t in out:
            fh.write(json.dumps(t) + '\n')
    print(f"# induced {len(out)} triples · {linked} touch a canon entity · → {op}")
    print("## sample (s --r--> o   [canon-linked? ✓]):")
    for t in out[:14]:
        mk = '✓' if (t['s_canon'] or t['o_canon']) else '·'
        print(f"  [{mk}] {t['s']}  --{t['r']}-->  {t['o']}")
    print("\n# next: review → sync-knowledge gates these into ontogenesis (SHACL) → HellGraph. Frontier model + full corpus = scale.")


if __name__ == '__main__':
    main()
