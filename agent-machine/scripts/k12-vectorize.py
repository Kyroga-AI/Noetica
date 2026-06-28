#!/usr/bin/env python3
"""
k12-vectorize — embed the captured K-12 content into brain shards (the OCW brain pipeline, applied to K-12).
Reads _k12_capture/manifest.json, chunks each captured text, embeds with nomic-embed-text (768-d), and writes
shards in the EXACT format study-brain.ts loads: {text, slug, field, material, node, license, dims, vec} where
vec = base64 little-endian Float32 (matching lib/brain-vec.ts encodeVec). Organized by field = the node's
subject, into a SEPARATE k12 brain dir (license-clean content only; segmented NC content would go elsewhere).

Run:  K12_VEC_LIMIT=40 python3 scripts/k12-vectorize.py     # validation cap; set 0 for the full vectorize
"""
import os, re, json, glob, base64, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURE = os.environ.get('K12_CAPTURE_DIR', os.path.join(HERE, '_k12_capture'))
BRAIN = os.environ.get('K12_BRAIN', os.path.expanduser('~/.noetica/brains/k12'))
OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
EMBED_MODEL = os.environ.get('NOETICA_EMBED_MODEL', 'nomic-embed-text')
LIMIT = int(os.environ.get('K12_VEC_LIMIT', '40'))   # chunks per text (validation cap; 0 = all)
slug = lambda s: re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')[:50]


def embed(text):
    req = urllib.request.Request(f'{OLLAMA}/api/embeddings',
        data=json.dumps({'model': EMBED_MODEL, 'prompt': text[:8000]}).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r).get('embedding', [])


def encode_vec(vec):
    """base64 little-endian Float32 — must byte-match lib/brain-vec.ts encodeVec."""
    return base64.b64encode(np.asarray(vec, dtype='<f4').tobytes()).decode()


def chunks(text, size=800):
    m = re.search(r'\*\*\*\s*START OF.*?\*\*\*(.*?)(\*\*\*\s*END OF|\Z)', text, re.S | re.I)   # strip PG boilerplate
    body = m.group(1) if m else text
    paras = [p.strip() for p in re.split(r'\n\s*\n', body) if len(re.sub(r'\s+', ' ', p.strip())) > 60]
    out, cur = [], ''
    for p in paras:
        if len(cur) + len(p) > size and cur:
            out.append(cur); cur = p
        else:
            cur = (cur + '\n' + p).strip()
    if cur:
        out.append(cur)
    return out


def main():
    mpath = os.path.join(CAPTURE, 'manifest.json')
    if not os.path.exists(mpath):
        print(f"# no capture manifest at {mpath} — run k12-capture.py first"); return
    captured = json.load(open(mpath))['captured']
    # node -> subject (field)
    node_subj = {}
    found = json.load(open(os.path.join(HERE, 'academy', 'k12-foundations.json')))
    for subj, blk in found['subjects'].items():
        for n in blk['nodes']:
            node_subj[n['id']] = subj
    # sanity: confirm the embedder works before the loop
    try:
        if len(embed('the quick brown fox')) != 768:
            print(f"# WARN: {EMBED_MODEL} did not return 768-d — check ollama");
    except Exception as e:
        print(f"# FATAL: embedder unreachable ({type(e).__name__}) — is ollama running with {EMBED_MODEL}?"); return

    total, by_field = 0, {}
    for item in captured:
        path = os.path.join(HERE, item['path'])
        if not os.path.exists(path):
            continue
        cs = chunks(open(path, encoding='utf-8', errors='ignore').read())
        if LIMIT:
            cs = cs[:LIMIT]
        field = node_subj.get(item.get('node'), 'language_arts')
        shards = []
        for ci, c in enumerate(cs):
            v = embed(c)
            if not v:
                continue
            shards.append({'text': c[:1200], 'slug': slug(item.get('title', '')), 'field': field,
                           'material': 'literature', 'node': item.get('node'), 'license': item.get('license'),
                           'dims': len(v), 'vec': encode_vec(v)})
        d = os.path.join(BRAIN, field); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, slug(item.get('title', '')) + '.jsonl'), 'w') as f:
            for s in shards:
                f.write(json.dumps(s) + '\n')
        by_field[field] = by_field.get(field, 0) + len(shards); total += len(shards)
        print(f"  {item.get('title','')[:42]:42} → {field}  ({len(shards)} chunks)")

    print(f"\n# K-12 brain: {total} chunks · fields={by_field} → {BRAIN}")
    print(f"# (validation cap K12_VEC_LIMIT={LIMIT} chunks/text; set 0 for the full vectorize, or run on GCP like the OCW brain)")


if __name__ == '__main__':
    main()
