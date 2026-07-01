#!/usr/bin/env python3
"""kg-bert-encode — KG-BERT over the entities + hyperedges we discover in the local HellGraph.

KG-BERT (Yao, Mao & Luo, 2019) frames knowledge-graph facts as TEXT and lets a pretrained transformer
score / embed them, so the graph's *structure* is learned in the SAME representation space as the canon
glossary — no separate TransE-style embedding table. This is the encoder half of the directive
("run a KG-BERT encoder over all the entities and hyper edges that we discover in that local graph").
It consumes the artifacts written by export-graph-for-kgbert.ts.

Two modes:
  embed  — encode every entity, triple and n-ary hyperedge sentence into a vector (mean-pooled CLS),
           save a single .npz (ids + matrix) for downstream retrieval / clustering / link-prediction.
  score  — KG-BERT triple plausibility: build positive triples + corrupted negatives (replace head or
           tail with a random entity), fine-tune a [CLS]->binary head, report held-out accuracy/AUC.
           This is the measured "does the graph cohere" signal; GPU-shaped.

Heavy run is GCP-shaped (--device cuda). --dry-run validates parsing + sequence construction with NO
model and NO torch import, so it is a safe CPU smoke. transformers/torch are imported lazily ONLY when
a real run is requested, and a missing dep prints an actionable message instead of a traceback.

Usage:
  python3 scripts/kg-bert-encode.py --mode embed --dry-run
  python3 scripts/kg-bert-encode.py --mode embed --model bert-base-uncased --device cuda --out kg-emb.npz
  python3 scripts/kg-bert-encode.py --mode score --model bert-base-uncased --device cuda --epochs 1
"""
import argparse
import json
import os
import random
import sys

KG = os.path.expanduser('~/.noetica/kg')


def load_jsonl(name, kgdir):
    p = os.path.join(kgdir, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return [json.loads(line) for line in f if line.strip()]


def build_sequences(kgdir, limit):
    """Collect the KG-BERT input sentences from all three artifacts, tagged by kind."""
    ents = load_jsonl('entities.jsonl', kgdir)[:limit]
    tris = load_jsonl('triples.jsonl', kgdir)[:limit]
    hyps = load_jsonl('hyperedges.jsonl', kgdir)[:limit]
    seqs = []
    for e in ents:
        seqs.append(('entity', e['id'], e.get('text', e.get('label', ''))))
    for t in tris:
        seqs.append(('triple', f"{t['h']}|{t['r']}|{t['t']}", t.get('sentence', '')))
    for h in hyps:
        seqs.append(('hyperedge', h['connector'], h.get('sentence', '')))
    return seqs, ents, tris, hyps


def corrupt_triples(tris, ents):
    """KG-BERT negative sampling: clone each positive triple, replace head OR tail with a random
    entity surface → a (likely) false fact. 1:1 positive:negative."""
    ent_texts = [e.get('text', '') for e in ents if e.get('text')]
    pos = [(t.get('sentence', ''), 1) for t in tris]
    neg = []
    for t in tris:
        if not ent_texts:
            break
        ht, rt, tt = t.get('h_text', ''), t.get('r_text', ''), t.get('t_text', '')
        if random.random() < 0.5:
            ht = random.choice(ent_texts)
        else:
            tt = random.choice(ent_texts)
        neg.append((f'{ht} {rt} {tt}', 0))
    return pos + neg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['embed', 'score'], default='embed')
    ap.add_argument('--kgdir', default=KG)
    ap.add_argument('--model', default='bert-base-uncased')
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--limit', type=int, default=10 ** 9)
    ap.add_argument('--batch', type=int, default=64)
    ap.add_argument('--epochs', type=int, default=1)
    ap.add_argument('--out', default='')
    ap.add_argument('--dry-run', action='store_true', help='parse + build sequences with NO model (CPU smoke)')
    a = ap.parse_args()

    seqs, ents, tris, hyps = build_sequences(a.kgdir, a.limit)
    print(f'loaded {len(ents)} entities, {len(tris)} triples, {len(hyps)} hyperedges '
          f'→ {len(seqs)} KG-BERT sequences', file=sys.stderr)
    if not seqs:
        print(f'no artifacts in {a.kgdir} — run export-graph-for-kgbert.ts first', file=sys.stderr)
        sys.exit(2)

    if a.dry_run:
        kinds = {}
        for k, _, _ in seqs:
            kinds[k] = kinds.get(k, 0) + 1
        print('  DRY-RUN sequence mix:', kinds, file=sys.stderr)
        for k, _id, txt in seqs[:3]:
            print(f'    [{k}] {txt[:100]}', file=sys.stderr)
        if a.mode == 'score':
            ex = corrupt_triples(tris[:5], ents)
            print(f'  score-mode would train on {len(ex)} examples (1:1 pos:neg); sample neg:',
                  next((s for s, y in ex if y == 0), '—')[:90], file=sys.stderr)
        print('  parsing + sequence construction OK — wire a --device cuda run for the real encode',
              file=sys.stderr)
        return

    # ── real run: lazy heavy imports so --dry-run never needs torch ──────────────
    try:
        import torch
        from transformers import AutoTokenizer, AutoModel, AutoModelForSequenceClassification
    except ImportError as e:
        print(f'missing dep ({e.name}); install with: pip install torch transformers', file=sys.stderr)
        sys.exit(3)

    tok = AutoTokenizer.from_pretrained(a.model)

    if a.mode == 'embed':
        import numpy as np
        model = AutoModel.from_pretrained(a.model).to(a.device).eval()
        ids, vecs = [], []
        with torch.no_grad():
            for i in range(0, len(seqs), a.batch):
                batch = seqs[i:i + a.batch]
                enc = tok([s for _, _, s in batch], padding=True, truncation=True,
                          max_length=64, return_tensors='pt').to(a.device)
                out = model(**enc).last_hidden_state            # [B, T, H]
                mask = enc['attention_mask'].unsqueeze(-1)      # mean-pool over real tokens
                pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1)
                vecs.append(pooled.cpu().numpy())
                ids.extend(f'{k}:{_id}' for k, _id, _ in batch)
                if (i // a.batch) % 20 == 0:
                    print(f'  embedded {i + len(batch)}/{len(seqs)}', file=sys.stderr)
        mat = np.vstack(vecs)
        dest = a.out or os.path.join(a.kgdir, 'kg-bert-embeddings.npz')
        np.savez_compressed(dest, ids=np.array(ids), embeddings=mat)
        print(f'wrote {dest} — {mat.shape[0]} vectors x {mat.shape[1]}d', file=sys.stderr)
        return

    # mode == 'score': fine-tune triple-plausibility head
    import numpy as np
    data = corrupt_triples(tris, ents)
    random.shuffle(data)
    split = int(0.9 * len(data))
    train, test = data[:split], data[split:]
    model = AutoModelForSequenceClassification.from_pretrained(a.model, num_labels=2).to(a.device)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-5)
    model.train()
    for ep in range(a.epochs):
        random.shuffle(train)
        for i in range(0, len(train), a.batch):
            batch = train[i:i + a.batch]
            enc = tok([s for s, _ in batch], padding=True, truncation=True, max_length=64,
                      return_tensors='pt').to(a.device)
            labels = torch.tensor([y for _, y in batch]).to(a.device)
            loss = model(**enc, labels=labels).loss
            opt.zero_grad(); loss.backward(); opt.step()
            if (i // a.batch) % 20 == 0:
                print(f'  ep{ep} {i}/{len(train)} loss={loss.item():.4f}', file=sys.stderr)
    model.eval()
    correct = 0
    with torch.no_grad():
        for i in range(0, len(test), a.batch):
            batch = test[i:i + a.batch]
            enc = tok([s for s, _ in batch], padding=True, truncation=True, max_length=64,
                      return_tensors='pt').to(a.device)
            pred = model(**enc).logits.argmax(-1).cpu().numpy()
            correct += int((pred == np.array([y for _, y in batch])).sum())
    acc = correct / max(1, len(test))
    print(f'KG-BERT triple-plausibility held-out accuracy: {acc:.4f} on {len(test)} examples', file=sys.stderr)


if __name__ == '__main__':
    main()
