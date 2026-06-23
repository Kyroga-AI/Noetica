#!/usr/bin/env python3
"""
fetch_medical_corpus — ingest the MedRAG Textbooks + StatPearls medical corpus into the brain as a
'medicine' field, so a small model + retrieval has the REQUISITE medical knowledge BEFORE we test
MedQA/USMLE properly (the prerequisite the plan names).

Why these corpora (validated, not guessed): MedRAG/MIRAGE (Xiong et al., Findings of ACL 2024) showed
Textbooks (the 18 USMLE textbooks, ~126k snippets) + StatPearls (~301k snippets) — ~58M tokens, the
SMALLEST corpora that deliver most of the MedQA lift (200x smaller than full MedCorp), redistribution-
OK for non-commercial research. RAG over them buys the KNOWLEDGE two-thirds of MedQA; the reasoning
third is gated by our knowledge-type classifier (lookup vs model) — that's why this is step 1, not the
whole answer.

This is step 1 (fetch + format → brain text chunks). Step 2 is vectorization (the embed pass, GPU/
compute job) → the loadable `medicine/*.jsonl` brain field with vectors.

Run (needs `pip install datasets`):  python3 scripts/fetch_medical_corpus.py [textbooks|statpearls|all]
  OCW_BRAIN  brain dir (default ~/Downloads/MIT OCW/_brain)
  MED_LIMIT  cap chunks per source (0 = all) — for a quick smoke run
"""
import os, json, sys

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
MED_DIR = os.path.join(BRAIN, 'medicine')
LIMIT = int(os.environ.get('MED_LIMIT', '0'))
SOURCES = {'textbooks': 'MedRAG/textbooks', 'statpearls': 'MedRAG/statpearls'}


def to_chunk(rec, material):
    """MedRAG snippet {id, title, content[, contents]} → brain chunk (text + metadata, pre-vector)."""
    text = (rec.get('content') or rec.get('contents') or '').strip()
    if len(text) < 80:                                  # too short to be useful evidence
        return None
    return {
        'text': text,
        'slug': str(rec.get('id') or '').strip() or material,
        'field': 'medicine',
        'material': material,                           # 'textbook' vs 'statpearls' — provenance
        'source': str(rec.get('title') or '')[:120],
    }


def main():
    which = (sys.argv[1] if len(sys.argv) > 1 else 'all')
    repos = SOURCES if which == 'all' else {which: SOURCES[which]}
    try:
        from datasets import load_dataset
    except ImportError:
        sys.exit("need `pip install datasets pyarrow` (run on the vectorize box)")
    os.makedirs(MED_DIR, exist_ok=True)
    total = 0
    # Fault-tolerant per source: a dead/moved dataset (StatPearls has relocated before) must NOT throw away
    # the source that loaded (Textbooks = the 18 USMLE textbooks, the medical core) or poison the exit code.
    for material, repo in repos.items():
        try:
            print(f"# loading {repo} (streaming) …", flush=True)
            ds = load_dataset(repo, split='train', streaming=True)
            n = 0
            with open(os.path.join(MED_DIR, f"{material}.jsonl"), 'w') as out:
                for rec in ds:
                    c = to_chunk(rec, material)
                    if not c:
                        continue
                    out.write(json.dumps(c) + '\n')
                    n += 1
                    if LIMIT and n >= LIMIT:
                        break
                    if n % 20000 == 0:
                        print(f"  {material}: {n} …", flush=True)
            total += n
            print(f"# {material}: wrote {n} chunks → {MED_DIR}/{material}.jsonl", flush=True)
        except Exception as e:
            print(f"  ! {repo} skipped: {type(e).__name__} {str(e)[:140]}", flush=True)
    print(f"# done — {total} medical chunks staged. NEXT (step 2): vectorize the 'medicine' field "
          f"(nomic embed) → loadable brain shards, then a MedQA/i-MedRAG eval.")


if __name__ == '__main__':
    main()
