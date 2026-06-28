#!/usr/bin/env python3
"""
fetch_legal_corpus — a REAL legal-knowledge corpus: the black-letter law (statutes + regulations +
the Constitution), the canonical codes, AND case law — not just court opinions. Federal first; state and
related datasets layer on after (set LEGAL_SCOPE=state once federal is solid).

This is the "Cornell Legal Information Institute" shape — US Code, CFR, the Constitution, and the courts
that apply them — assembled from machine-readable, redistribution-OK sources:

  STATUTES     HFforLegal/laws        jurisdictional statutes (the actual law), filtered to federal/US
  CODE/BROAD   lexlms/lex_files       US Code + court opinions + the LexLMS legal pretraining corpus
  CASELAW      free-law/<juris> (CAP) public-domain court opinions (Caselaw Access Project)
  CANON        govt bulk XML          the EXACT US Code (uscode.house.gov) + CFR (govinfo) + Constitution
                                      — what Cornell LII serves. Gated by CANON=1 (download + parse).

Knowledge ≠ advice: the life-domain tagger still attaches the "not legal advice, consult a lawyer"
disclaimer at answer time.

Run (needs `pip install datasets pyarrow`):  python3 scripts/fetch_legal_corpus.py
  OCW_BRAIN       brain dir (default ~/Downloads/MIT OCW/_brain)
  LEGAL_LIMIT     cap chunks per source (0 = all)
  LEGAL_CHUNK     chars per chunk (default 1500)
  LEGAL_SCOPE     federal (default) | all  — federal-first; `all` includes state jurisdictions
  CANON           1 = also fetch the canonical US Code + CFR + Constitution from government bulk
  CAP_SOURCES     comma list of free-law CAP repos (default a confirmed set); unknown ones are skipped
"""
import os, json, sys, re, io, zipfile, urllib.request

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
LEGAL_DIR = os.path.join(BRAIN, 'legal')
LIMIT = int(os.environ.get('LEGAL_LIMIT', '0'))
CHUNK = int(os.environ.get('LEGAL_CHUNK', '1500'))
SCOPE = os.environ.get('LEGAL_SCOPE', 'federal').lower()
CANON = os.environ.get('CANON', '0') == '1'
CAP_SOURCES = [s.strip() for s in os.environ.get('CAP_SOURCES', 'free-law/nh').split(',') if s.strip()]
FEDERAL_JUR = re.compile(r'\b(us|u\.s\.|usa|united[- ]?states|federal)\b', re.I)


def chunks_of(text, size=None):
    size = size or CHUNK
    text = re.sub(r'[ \t]+', ' ', re.sub(r'\n{3,}', '\n\n', (text or '').strip()))
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


def write_rows(material, rows):
    path = os.path.join(LEGAL_DIR, f"{material}.jsonl")
    with open(path, 'w') as out:
        for r in rows:
            out.write(json.dumps(r) + '\n')
    print(f"# {material}: wrote {len(rows)} chunks → {path}", flush=True)
    return len(rows)


def emit(material, text, slug, source):
    rows = []
    for ci, c in enumerate(chunks_of(text)):
        rows.append({'text': c, 'slug': f"{slug}-{ci}", 'field': 'legal', 'material': material, 'source': str(source)[:160]})
    return rows


# ── HF dataset sources ─────────────────────────────────────────────────────────
def fetch_hf(load_dataset):
    written = 0
    # STATUTES — the actual law (federal first). Field-robust: the last run wrote 0 chunks because the
    # text/jurisdiction field names were guessed wrong (HF schemas vary), so emit() got empty text AND the
    # federal filter dropped everything. Pull text + jurisdiction from the first non-empty candidate field,
    # only apply the federal filter when a jurisdiction is actually present (unknown → keep, don't zero out),
    # and log the schema on the first record so a future mismatch is obvious.
    def _first(rec, keys):
        for k in keys:
            v = rec.get(k)
            if v:
                return v
        return ''
    try:
        print("# loading HFforLegal/laws (statutes) …", flush=True)
        ds = load_dataset('HFforLegal/laws', split='train', streaming=True)
        rows, n = [], 0
        for rec in ds:
            if n == 0:
                print(f"  HFforLegal/laws fields: {sorted(rec.keys())}", flush=True)
            text = _first(rec, ('text', 'content', 'body', 'law_text', 'article', 'full_text', 'document'))
            jur = str(_first(rec, ('jurisdiction', 'country', 'region', 'locale', 'state')) or '')
            n += 1
            if not text:
                continue
            if SCOPE == 'federal' and jur and not FEDERAL_JUR.search(jur):
                continue   # only skip when we KNOW it's non-federal; unknown jurisdiction → keep
            slug = _first(rec, ('id_main', 'id', 'identifier')) or n
            rows += emit('statute', text, f"statute-{slug}", _first(rec, ('title_main', 'title', 'name')) or jur)
            if LIMIT and len(rows) >= LIMIT:
                break
        written += write_rows('statute', rows[:LIMIT or None])
    except Exception as e:
        print(f"  ! statutes skipped: {type(e).__name__} {str(e)[:120]}", flush=True)

    # CODE / BROAD — US Code + opinions + LexLMS corpus
    try:
        print("# loading lexlms/lex_files (code/broad) …", flush=True)
        ds = load_dataset('lexlms/lex_files', split='train', streaming=True)
        rows = []
        for i, rec in enumerate(ds):
            rows += emit('code', rec.get('text') or '', f"code-{i}", rec.get('url') or 'lexlms')
            if LIMIT and len(rows) >= LIMIT:
                break
        written += write_rows('code', rows[:LIMIT or None])
    except Exception as e:
        print(f"  ! code/broad skipped: {type(e).__name__} {str(e)[:120]}", flush=True)

    # CASELAW — court opinions (CAP)
    for repo in CAP_SOURCES:
        try:
            juris = repo.split('/')[-1]
            print(f"# loading {repo} (caselaw) …", flush=True)
            ds = load_dataset(repo, split='train', streaming=True)
            rows = []
            for i, rec in enumerate(ds):
                rows += emit('caselaw', rec.get('text') or rec.get('casebody') or '', f"caselaw-{juris}-{i}",
                             f"{rec.get('name_abbreviation') or ''} ({rec.get('court') or ''}, {rec.get('decision_date') or ''})")
                if LIMIT and len(rows) >= LIMIT:
                    break
            written += write_rows(f'caselaw-{juris}', rows[:LIMIT or None])
        except Exception as e:
            print(f"  ! {repo} skipped: {type(e).__name__} {str(e)[:120]}", flush=True)
    return written


# ── Canonical government bulk: the EXACT US Code + CFR + Constitution (Cornell-LII source) ──────────────
def strip_xml(xml_bytes):
    t = xml_bytes.decode('utf-8', 'replace')
    t = re.sub(r'<[^>]+>', ' ', t)                         # drop tags — keep the legal TEXT
    t = re.sub(r'&[a-z]+;', ' ', t)
    return re.sub(r'[ \t]+', ' ', t)


def fetch_canon():
    written = 0
    # CFR — govinfo bulk has predictable per-title URLs (probe confirmed 200)
    year = os.environ.get('CFR_YEAR', '2024')
    rows = []
    for title in range(1, 51):
        for vol in range(1, 12):
            url = f"https://www.govinfo.gov/bulkdata/CFR/{year}/title-{title}/CFR-{year}-title{title}-vol{vol}.xml"
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    txt = strip_xml(r.read())
            except Exception:
                break                                       # no more vols for this title
            rows += emit('regulation', txt, f"cfr-t{title}-v{vol}", f"{year} CFR Title {title}")
            if LIMIT and len(rows) >= LIMIT:
                break
        if LIMIT and len(rows) >= LIMIT:
            break
    if rows:
        written += write_rows('cfr', rows[:LIMIT or None])

    # US Code — OLRC publishes the whole code as one USLM-XML ZIP per release point.
    rp = os.environ.get('USC_RELEASE', '119/4')            # congress/public-law; bump per release point
    url = f"https://uscode.house.gov/download/releasepoints/us/pl/{rp}/xml_uscAll@{rp.replace('/', '-')}.zip"
    try:
        print(f"# fetching US Code bulk {url} …", flush=True)
        data = urllib.request.urlopen(url, timeout=600).read()
        rows = []
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for name in z.namelist():
                if not name.endswith('.xml'):
                    continue
                rows += emit('statute', strip_xml(z.read(name)), f"usc-{os.path.basename(name)}", f"US Code {name}")
                if LIMIT and len(rows) >= LIMIT:
                    break
        if rows:
            written += write_rows('uscode', rows[:LIMIT or None])
    except Exception as e:
        print(f"  ! US Code bulk skipped ({type(e).__name__} {str(e)[:90]}) — bump USC_RELEASE to the current release point", flush=True)
    return written


def main():
    try:
        from datasets import load_dataset
    except ImportError:
        sys.exit("need `pip install datasets pyarrow`")
    os.makedirs(LEGAL_DIR, exist_ok=True)
    total = fetch_hf(load_dataset)
    if CANON:
        total += fetch_canon()
    print(f"# done — {total} legal chunks staged (scope={SCOPE}, canon={CANON}). NEXT: vectorize_field.py legal", flush=True)


if __name__ == '__main__':
    main()
