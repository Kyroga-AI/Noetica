#!/usr/bin/env python3
"""
corpus-quality-bench — measure + COMPARE corpus quality: OUR brain (OCW/medicine/legal) vs the open
reference corpora the field actually uses (FineWeb-Edu = education-filtered web, peS2o = academic papers,
and any HF textbook set). The first defensible "where does our corpus stand" readout.

Governance: this is ANALYSIS, not ingestion. Sampled docs land in the SEGMENTED Knowledge Commons
(gs://.../knowledge-commons/external/), never mixed into the training brain. Reference corpora stream from
HF (no full download). edX/Coursera are NOT here — ARR + auth; only CC-open sources.

Metrics (per source, on a sample — all CPU, no model needed unless EDU_CLASSIFIER=1):
  volume       docs, mean/median chars, mean whitespace-tokens
  lexical      sample vocab size, mean per-doc type-token ratio (first 200 words, length-normalized)
  technical    % docs with math, % with code, mean digit density
  hygiene      near-dup rate (120-char prefix), junk ratio (U+FFFD / control chars), letters ratio
  educational  FineWeb-Edu classifier score 0-5 (EDU_CLASSIFIER=1 — the standard edu-quality metric)
  gold (ours)  % solution/exam/pset material (our curation edge)

Run:  python3 scripts/corpus-quality-bench.py
  CQ_LIMIT     docs/source (default 4000)        CQ_SOURCES  comma list (default ours,fineweb-edu,pes2o)
  CQ_OUT       out dir (default ~/.noetica/corpus-quality)   EDU_CLASSIFIER 1 = also score edu quality
  OCW_BRAIN    our brain dir                     CQ_TEXTBOOK_DS  add a textbook HF dataset id (e.g. OpenStax)
"""
import os, sys, re, json, hashlib, statistics, collections

LIMIT = int(os.environ.get('CQ_LIMIT', '4000'))
OUT = os.path.expanduser(os.environ.get('CQ_OUT', '~/.noetica/corpus-quality'))
BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
SOURCES = [s.strip() for s in os.environ.get('CQ_SOURCES', 'ours,fineweb-edu,pes2o').split(',') if s.strip()]
TEXTBOOK_DS = os.environ.get('CQ_TEXTBOOK_DS', '')
_WORD = re.compile(r"[A-Za-z]+")
_MATH = re.compile(r"(\\[a-zA-Z]+|\$.+?\$|[=≤≥≈∫∑√±×÷·]|\^|_\{|\\frac|\\int|\\sum)")
_CODE = re.compile(r"(\bdef \b|\bimport \b|\bfunction\b|[{};]\s*$|=>|::|</?[a-z]+>)", re.M)


def our_docs():
    for fld in sorted(os.listdir(BRAIN)) if os.path.isdir(BRAIN) else []:
        d = os.path.join(BRAIN, fld)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if not fn.endswith('.jsonl'):
                continue
            for ln in open(os.path.join(d, fn), errors='replace'):
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                if o.get('text'):
                    yield {'text': o['text'], 'material': o.get('material', '?')}


def hf_docs(ds_id, config, field):
    from datasets import load_dataset
    ds = load_dataset(ds_id, config, split='train', streaming=True) if config else load_dataset(ds_id, split='train', streaming=True)
    for r in ds:
        t = r.get(field) or r.get('text') or ''
        if t:
            yield {'text': t, 'material': '-'}


SRC = {
    'ours':        lambda: our_docs(),
    'fineweb-edu': lambda: hf_docs('HuggingFaceFW/fineweb-edu', 'sample-10BT', 'text'),
    'pes2o':       lambda: hf_docs('allenai/peS2o', None, 'text'),
}
if TEXTBOOK_DS:
    SRC['textbooks'] = lambda: hf_docs(TEXTBOOK_DS, None, 'text')


def measure(name, gen):
    os.makedirs(OUT, exist_ok=True)
    sample_path = os.path.join(OUT, f'{name}.sample.jsonl')
    n = chars = words = math = code = digits = junk = letters = 0
    lens, ttrs, vocab, seen, dups, golds = [], [], set(), set(), 0, 0
    with open(sample_path, 'w') as sf:
        for o in gen():
            t = o['text']
            if len(t) < 40:
                continue
            n += 1
            sf.write(json.dumps({'text': t[:4000], 'material': o.get('material', '-')}) + '\n')
            chars += len(t)
            lens.append(len(t))
            ws = t.split()
            words += len(ws)
            w = _WORD.findall(t.lower())
            vocab.update(w)
            if w[:200]:
                ttrs.append(len(set(w[:200])) / len(w[:200]))
            if _MATH.search(t):
                math += 1
            if _CODE.search(t):
                code += 1
            digits += sum(c.isdigit() for c in t)
            letters += sum(c.isalpha() for c in t)
            junk += t.count('�') + sum(1 for c in t if ord(c) < 9 or 11 <= ord(c) < 32)
            h = hashlib.md5(t[:120].encode('utf-8', 'replace')).hexdigest()
            if h in seen:
                dups += 1
            seen.add(h)
            if o.get('material') in ('solution', 'exam', 'assignment', 'problem', 'pset', 'quiz', 'recitation'):
                golds += 1
            if n >= LIMIT:
                break
    if not n:
        return None
    return {'docs': n, 'mean_chars': round(chars / n), 'median_chars': int(statistics.median(lens)),
            'mean_words': round(words / n), 'vocab': len(vocab), 'mean_ttr': round(statistics.mean(ttrs), 3) if ttrs else 0,
            'pct_math': round(100 * math / n, 1), 'pct_code': round(100 * code / n, 1),
            'digit_density': round(100 * digits / max(chars, 1), 2), 'letters_ratio': round(letters / max(chars, 1), 2),
            'dup_rate': round(100 * dups / n, 1), 'junk_per_kchar': round(1000 * junk / max(chars, 1), 2),
            'gold_pct': round(100 * golds / n, 1)}


def edu_scores(name):
    """FineWeb-Edu classifier: educational-quality 0-5. Optional (EDU_CLASSIFIER=1)."""
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import torch
    tok = AutoTokenizer.from_pretrained('HuggingFaceFW/fineweb-edu-classifier')
    mdl = AutoModelForSequenceClassification.from_pretrained('HuggingFaceFW/fineweb-edu-classifier')
    scs = []
    for ln in open(os.path.join(OUT, f'{name}.sample.jsonl')):
        t = json.loads(ln)['text']
        with torch.no_grad():
            s = mdl(**tok(t, return_tensors='pt', truncation=True, max_length=512)).logits.squeeze(-1).item()
        scs.append(max(0, min(5, s)))
        if len(scs) >= 1000:
            break
    return round(statistics.mean(scs), 2) if scs else None


def main():
    res = {}
    for name in SOURCES:
        if name not in SRC:
            print(f"  ! unknown source {name}", flush=True); continue
        print(f"# measuring {name} (≤{LIMIT} docs) …", flush=True)
        try:
            m = measure(name, SRC[name])
            if m and os.environ.get('EDU_CLASSIFIER') == '1':
                m['edu_score'] = edu_scores(name)
            res[name] = m
        except Exception as e:
            print(f"  ! {name} skipped: {type(e).__name__} {str(e)[:120]}", flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump(res, open(os.path.join(OUT, 'metrics.json'), 'w'), indent=2)
    cols = ['docs', 'mean_chars', 'mean_words', 'vocab', 'mean_ttr', 'pct_math', 'pct_code', 'digit_density', 'dup_rate', 'junk_per_kchar', 'gold_pct']
    if os.environ.get('EDU_CLASSIFIER') == '1':
        cols.append('edu_score')
    print(f"\n{'metric':16}" + ''.join(f"{s:>14}" for s in res))
    for c in cols:
        print(f"{c:16}" + ''.join(f"{str(res[s].get(c, '-') if res[s] else '-'):>14}" for s in res))
    print(f"\n# metrics + segmented samples → {OUT}  (preserve to knowledge-commons/external/)")


if __name__ == '__main__':
    main()
