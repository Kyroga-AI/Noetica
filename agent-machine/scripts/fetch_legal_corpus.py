#!/usr/bin/env python3
"""
fetch_legal_corpus — ingest a legal-knowledge corpus into the brain as a 'legal' field, so retrieval has
the REQUISITE legal knowledge (statutes, regulations, case law, practical Q&A) BEFORE we test legal QA —
exactly the way fetch_medical_corpus.py stages 'medicine'.

Why these corpora (validated, not guessed): Pile of Law (Henderson et al., NeurIPS 2022 D&B) is the legal
analog of MedRAG — a large, curated, redistribution-OK (CC-BY-NC-SA / public-domain) corpus assembled FROM
authoritative legal sources. We take the highest-signal subsets for a general legal knowledge brain:
  - statutes      US Code            (the black-letter law)
  - regulations   CFR                (federal regulations)
  - caselaw       CourtListener ops  (how courts apply it)
  - legal_qa      r/legaladvice      (practical, FAQ-style application — good for "discuss" use)
RAG over these buys the lookup-dominated two-thirds of legal QA; the reasoning third is gated by our
knowledge-type classifier (lookup vs model), same split as medicine. This is STEP 1 (fetch + chunk →
brain text chunks). Step 2 is vectorization (scripts/vectorize_field.py legal — the GPU embed pass).

NOTE: this stages KNOWLEDGE for retrieval; the life-domain tagger still attaches the "general info, not
legal advice, consult a lawyer" disclaimer at answer time. Knowledge ≠ advice.

Run (needs `pip install datasets pyarrow`):  python3 scripts/fetch_legal_corpus.py [statutes|regulations|caselaw|legal_qa|all]
  OCW_BRAIN    brain dir (default ~/Downloads/MIT OCW/_brain)
  LEGAL_LIMIT  cap chunks per source (0 = all) — for a quick smoke run
  LEGAL_CHUNK  chars per chunk for long documents (default 1500)
"""
import os, json, sys, re

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
LEGAL_DIR = os.path.join(BRAIN, 'legal')
LIMIT = int(os.environ.get('LEGAL_LIMIT', '0'))
CHUNK = int(os.environ.get('LEGAL_CHUNK', '1500'))

# material -> (hf repo, config). Pile of Law ships one config per subset.
SOURCES = {
    'statutes':    ('pile-of-law/pile-of-law', 'uscode'),
    'regulations': ('pile-of-law/pile-of-law', 'cfr'),
    'caselaw':     ('pile-of-law/pile-of-law', 'courtlistener_opinions'),
    'legal_qa':    ('pile-of-law/pile-of-law', 'r_legaladvice'),
}


def chunks_of(text, size):
    """Pile-of-law records are whole documents (a statute, an opinion) — split into retrieval-sized pieces."""
    text = re.sub(r'\s+\n', '\n', (text or '').strip())
    if len(text) <= size:
        return [text] if len(text) >= 80 else []
    out, cur = [], ''
    for para in re.split(r'\n{2,}', text):
        if len(cur) + len(para) + 2 > size and cur:
            out.append(cur.strip()); cur = ''
        cur += para + '\n\n'
    if len(cur.strip()) >= 80:
        out.append(cur.strip())
    return out


def main():
    which = (sys.argv[1] if len(sys.argv) > 1 else 'all')
    repos = SOURCES if which == 'all' else {which: SOURCES[which]}
    try:
        from datasets import load_dataset
    except ImportError:
        sys.exit("need `pip install datasets pyarrow` (run on the vectorize box)")
    os.makedirs(LEGAL_DIR, exist_ok=True)
    total = 0
    for material, (repo, config) in repos.items():
        print(f"# loading {repo}:{config} (streaming) …", flush=True)
        ds = load_dataset(repo, config, split='train', streaming=True)
        n = 0
        with open(os.path.join(LEGAL_DIR, f"{material}.jsonl"), 'w') as out:
            for i, rec in enumerate(ds):
                for ci, c in enumerate(chunks_of(rec.get('text', ''), CHUNK)):
                    out.write(json.dumps({
                        'text': c,
                        'slug': f"{material}-{i}-{ci}",
                        'field': 'legal',
                        'material': material,           # statutes/regulations/caselaw/legal_qa — provenance
                        'source': str(rec.get('url') or '')[:160],
                    }) + '\n')
                    n += 1
                    if LIMIT and n >= LIMIT:
                        break
                if LIMIT and n >= LIMIT:
                    break
                if n and n % 20000 == 0:
                    print(f"  {material}: {n} …", flush=True)
        total += n
        print(f"# {material}: wrote {n} chunks → {LEGAL_DIR}/{material}.jsonl", flush=True)
    print(f"# done — {total} legal chunks staged. NEXT (step 2): vectorize the 'legal' field "
          f"(nomic embed) → loadable brain shards:  python3 scripts/vectorize_field.py legal")


if __name__ == '__main__':
    main()
