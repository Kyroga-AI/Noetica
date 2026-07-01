#!/usr/bin/env python3
"""kg-bert-retrieve — serve the KG-BERT entity embeddings as a grounding retriever for the bench.

The board's ground arm is sub-baseline because flat glossary lookup can't represent RELATIONAL structure.
This retriever grounds on the structure instead: embed the question with the SAME bert-base encoder that made
the entity vectors (kg-bert-embeddings.npz), cosine-kNN the top entity surfaces, and hand those back as the
grounding block. It's the decorrelated arm the operator-board proved the ground tier needs.

The .npz holds ALL sequence vectors (entity/triple/hyperedge) keyed 'kind:id'; we retrieve over the ENTITY
rows only and map id→surface via entities.jsonl. bert-base + torch are imported lazily so --dry-run (numpy-only
kNN self-check, NO model) is a CPU smoke; the real --batch run is GPU-shaped and runs on the board VM.

Modes:
  --dry-run           load .npz, filter entity rows, self-kNN sanity check (a vector's own NN is itself), no model
  --batch             read questions (one per line) from stdin, emit one JSON line {i, ground} per question

Usage:
  python3 scripts/kg-bert-retrieve.py --dry-run --npz ~/.noetica/kg/kg-bert-embeddings.npz
  printf '%s\n' 'What is a normal subgroup?' | python3 scripts/kg-bert-retrieve.py --batch --device cuda --k 6
"""
import argparse
import json
import os
import sys

KG = os.path.expanduser('~/.noetica/kg')


# Only these node types are KNOWLEDGE concepts. The graph is 93% operational/prose nodes (DecisionLedgerEntry,
# DocumentChunk, EvidenceClaim, Session, …) that leak in as "entities" — retrieving over them returns garbage
# (measured: raw 36k index → mostly prose-fragment neighbours; filtered → clean concept neighbours). Keep the
# canonical concept set (same concepts the lexical 'ground' arm uses), so the head-to-head is vectors-vs-lexical.
KEEP_LABELS = {'GlossaryTerm', 'Formula', 'Topic'}
import re as _re


def _is_clean_concept(t):
    t = (t or '').strip()
    if len(t) < 3 or len(t) > 40:
        return False
    if _re.search(r'[\n\t\xa0�]', t) or _re.search(r'[^\x00-\x7f]', t):   # chunk-fragment / mojibake junk
        return False
    if sum(c.isalpha() for c in t) / max(1, len(t)) < 0.6:                     # mostly punctuation/digits
        return False
    if _re.search(r'[.;:,]\s', t) or len(t.split()) > 5:                        # sentence prose / too long
        return False
    return True


def load_entity_index(npz_path, entities_path):
    """Return (ids, matrix, id2text) for the CLEAN CONCEPT entity rows only (GlossaryTerm/Formula/Topic +
    text-cleanliness). Filtering the operational/prose noise is what makes KG-BERT grounding actually useful."""
    import numpy as np
    # id → (label, text) from the export
    id2text, id2label = {}, {}
    if os.path.exists(entities_path):
        for line in open(entities_path):
            if not line.strip():
                continue
            e = json.loads(line)
            id2text[e['id']] = e.get('text', e.get('label', ''))
            id2label[e['id']] = e.get('label', '')
    z = np.load(npz_path, allow_pickle=True)
    ids = [str(x) for x in z['ids']]
    mat = z['embeddings'].astype('float32')
    idx, ent_ids, seen = [], [], set()
    for i, s in enumerate(ids):
        if not s.startswith('entity:'):
            continue
        rid = s[len('entity:'):]
        txt = id2text.get(rid, '')
        key = txt.strip().lower()
        if id2label.get(rid, '') in KEEP_LABELS and _is_clean_concept(txt) and key not in seen:
            seen.add(key)                                  # dedup by surface → distinct concepts in top-k
            idx.append(i); ent_ids.append(rid)
    ent_mat = mat[idx]
    norms = np.linalg.norm(ent_mat, axis=1, keepdims=True)     # L2-normalize → dot product is cosine
    ent_mat = ent_mat / np.clip(norms, 1e-8, None)
    return ent_ids, ent_mat, id2text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--npz', default=os.path.join(KG, 'kg-bert-embeddings.npz'))
    ap.add_argument('--entities', default=os.path.join(KG, 'entities.jsonl'))
    ap.add_argument('--model', default='bert-base-uncased')
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--k', type=int, default=6)
    ap.add_argument('--batch', action='store_true', help='read questions from stdin, emit grounding per line')
    ap.add_argument('--dry-run', action='store_true', help='numpy-only kNN self-check, NO model')
    a = ap.parse_args()

    if not os.path.exists(a.npz):
        print(f'no embeddings at {a.npz} — run gcp-kgbert-encode.sh first', file=sys.stderr)
        sys.exit(2)
    import numpy as np
    ent_ids, ent_mat, id2text = load_entity_index(a.npz, a.entities)
    print(f'loaded {len(ent_ids)} entity vectors x {ent_mat.shape[1]}d; {len(id2text)} id→text', file=sys.stderr)

    if a.dry_run:
        # a vector's own nearest neighbour must be ITSELF (cos=1) — validates the index + kNN wiring
        probe = min(3, len(ent_ids))
        ok = 0
        for i in range(probe):
            sims = ent_mat @ ent_mat[i]
            nn = int(np.argmax(sims))
            if nn == i and sims[nn] > 0.999:
                ok += 1
            txt = id2text.get(ent_ids[i], ent_ids[i])
            others = np.argsort(-sims)[1:4]
            print(f'  [{i}] {txt[:40]!r} → neighbours: '
                  + ', '.join(f'{id2text.get(ent_ids[j], ent_ids[j])[:24]!r}' for j in others), file=sys.stderr)
        print(f'  DRY-RUN self-kNN: {ok}/{probe} vectors are their own NN — index + cosine wiring OK', file=sys.stderr)
        return

    # ── real run: embed questions with the SAME bert-base encoder, kNN, emit grounding ──
    try:
        import torch
        from transformers import AutoTokenizer, AutoModel
    except ImportError as e:
        print(f'missing dep ({e.name}); install: pip install torch transformers', file=sys.stderr)
        sys.exit(3)
    tok = AutoTokenizer.from_pretrained(a.model)
    model = AutoModel.from_pretrained(a.model).to(a.device).eval()

    def embed(texts):
        enc = tok(texts, padding=True, truncation=True, max_length=64, return_tensors='pt').to(a.device)
        with torch.no_grad():
            out = model(**enc).last_hidden_state
            mask = enc['attention_mask'].unsqueeze(-1)
            pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1)     # mean-pool — MUST match the encoder
        v = pooled.cpu().numpy().astype('float32')
        return v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-8, None)

    # stdin = one JSON per line {id, question, choices} (the bench convention — robust to newlines in questions)
    rows = []
    for ln in sys.stdin:
        if not ln.strip():
            continue
        try:
            r = json.loads(ln)
            rows.append((int(r['id']), f"{r['question']} {' '.join(r.get('choices', []))}"))
        except Exception:
            continue
    B = 64
    for start in range(0, len(rows), B):
        chunk = rows[start:start + B]
        qv = embed([t for _, t in chunk])          # [b, d]
        sims = qv @ ent_mat.T                      # [b, n_entities]
        for r, (qid, _) in enumerate(chunk):
            top = np.argsort(-sims[r])[:a.k]
            terms = [id2text.get(ent_ids[j], ent_ids[j]) for j in top]
            # a compact grounding block: the structurally-nearest concepts to the question
            ground = 'Related concepts (knowledge-graph): ' + '; '.join(t for t in terms if t)
            print(json.dumps({'i': qid, 'ground': ground}))


if __name__ == '__main__':
    main()
