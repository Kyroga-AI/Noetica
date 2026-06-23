#!/usr/bin/env python3
"""
fetch_legal_corpus — ingest a legal-knowledge corpus into the brain as a 'legal' field, so retrieval has
the REQUISITE legal knowledge (statutes, regulations, case law, practical Q&A) BEFORE we test legal QA —
exactly the way fetch_medical_corpus.py stages 'medicine'.

Why these corpora (validated, not guessed): the Caselaw Access Project (Harvard/Free Law Project) is the
authoritative US case-law corpus — millions of court opinions, public-domain, distributed on HF as
standard Parquet per jurisdiction (`free-law/<state>`), each record carrying the opinion `text` plus rich
metadata (court, jurisdiction, citations, date). It is the case-law backbone of a legal knowledge brain.
(Pile of Law — the prior plan — is a loading-SCRIPT dataset that `datasets` >=3 no longer supports, so we
moved to the Parquet CAP datasets.) RAG over these buys the lookup-dominated bulk of legal QA; the
reasoning third is gated by our knowledge-type classifier (lookup vs model), same split as medicine. This
is STEP 1 (fetch + chunk → brain text chunks); step 2 is vectorization (scripts/vectorize_field.py legal —
the GPU embed pass).

NOTE: this stages KNOWLEDGE for retrieval; the life-domain tagger still attaches the "general info, not
legal advice, consult a lawyer" disclaimer at answer time. Knowledge ≠ advice. (Statutes/regs — US Code,
CFR — are a future add once a Parquet source is wired; case law is the bulk.)

Run (needs `pip install datasets pyarrow`):  python3 scripts/fetch_legal_corpus.py [all]
  OCW_BRAIN      brain dir (default ~/Downloads/MIT OCW/_brain)
  LEGAL_LIMIT    cap chunks per source (0 = all) — for a quick smoke / overnight cap
  LEGAL_CHUNK    chars per chunk for long opinions (default 1500)
  LEGAL_SOURCES  comma-separated HF repos (default a CAP jurisdiction set) — bad/missing ones are skipped
"""
import os, json, sys, re

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
LEGAL_DIR = os.path.join(BRAIN, 'legal')
LIMIT = int(os.environ.get('LEGAL_LIMIT', '0'))
CHUNK = int(os.environ.get('LEGAL_CHUNK', '1500'))
# Caselaw Access Project jurisdictions on HF (Parquet). Override/extend with LEGAL_SOURCES; unknown repos
# are skipped, not fatal. A representative federal-influential set by default.
SOURCES = [s.strip() for s in os.environ.get(
    'LEGAL_SOURCES',
    'free-law/nh,free-law/cal,free-law/ny,free-law/mass,free-law/tex,free-law/ill,free-law/pa,free-law/fla,free-law/ohio,free-law/va'
).split(',') if s.strip()]


def chunks_of(text, size):
    """CAP records are whole opinions — split into retrieval-sized pieces."""
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
    try:
        from datasets import load_dataset
    except ImportError:
        sys.exit("need `pip install datasets pyarrow` (run on the vectorize box)")
    os.makedirs(LEGAL_DIR, exist_ok=True)
    total = 0
    for repo in SOURCES:
        material = repo.split('/')[-1]                 # e.g. free-law/nh -> nh (the jurisdiction)
        print(f"# loading {repo} (streaming) …", flush=True)
        try:
            ds = load_dataset(repo, split='train', streaming=True)
        except Exception as e:
            print(f"  ! skip {repo}: {type(e).__name__} {str(e)[:120]}", flush=True)
            continue
        n = 0
        with open(os.path.join(LEGAL_DIR, f"{material}.jsonl"), 'w') as out:
            for i, rec in enumerate(ds):
                for ci, c in enumerate(chunks_of(rec.get('text') or rec.get('casebody') or '', CHUNK)):
                    out.write(json.dumps({
                        'text': c,
                        'slug': f"{material}-{i}-{ci}",
                        'field': 'legal',
                        'material': f"caselaw-{material}",     # provenance: jurisdiction
                        'source': f"{rec.get('name_abbreviation') or rec.get('name') or ''} ({rec.get('court') or ''}, {rec.get('decision_date') or ''})"[:160],
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
