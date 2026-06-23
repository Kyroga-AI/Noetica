#!/usr/bin/env python3
"""
ocw-resource-capture — capture OCW course SUBSTANCE via the per-resource data.json API. The old zip
"Download Course" mechanism is dead post-migration (capture stuck at 991/2577); OCW now serves a clean
structured API instead:

  /courses/{slug}/sitemap.xml          → every /resources/{id}/ and /pages/{id}/ URL for the course
  /courses/{slug}/{resource}/data.json → {file, file_type, content, body, learning_resource_types, license}

So per course we: list resources from the sitemap → read each data.json → for DOCUMENTS download the file and
extract text with PYMUPDF (math-aware — recovers the equations pypdf shredded); for PAGES use the rendered
`content`/`body` HTML → classify by `learning_resource_types` (the same taxonomy build-corpus uses) → emit
chunks. Bucket-backed (substance streams to GCS, no local bloat — only transient file downloads), resumable
(a GCS manifest of done slugs), rate-limited, fault-tolerant per course/resource.

AGNOSTIC-READY: the MIT-specific logic is isolated in resource_urls()/extract_resource(); a sibling adapter
(TU Delft / OpenLearn / UTokyo) drops in with the same engine. CC-licensed only — we skip non-open `license`.

Run (needs pymupdf):  python3 scripts/ocw-resource-capture.py
  OCW_CATALOG   slug list (default ~/Downloads/MIT OCW/_catalog_all_slugs.txt)
  OCW_GCS       dest bucket prefix (default gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit)
  OCW_DEPTS     restrict to dept codes (e.g. "18,8,5,7,6"); empty = all
  OCW_LIMIT     max courses this run (0 = all)         OCW_DELAY_MS  polite delay (default 1500)
  OCW_CHUNK     chars/chunk (default 1500)
"""
import os, sys, re, json, time, html, tempfile, subprocess, urllib.request

HOME = os.path.expanduser('~')
CATALOG = os.environ.get('OCW_CATALOG', os.path.join(HOME, 'Downloads', 'MIT OCW', '_catalog_all_slugs.txt'))
GCS = os.environ.get('OCW_GCS', 'gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit')
DEPTS = set(d.strip() for d in os.environ.get('OCW_DEPTS', '').split(',') if d.strip())
LIMIT = int(os.environ.get('OCW_LIMIT', '0'))
DELAY = float(os.environ.get('OCW_DELAY_MS', '1500')) / 1000
CHUNK = int(os.environ.get('OCW_CHUNK', '1500'))
BASE = 'https://ocw.mit.edu'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
LRT = {  # learning_resource_types → material (mirrors build-corpus.ts)
    'Lecture Notes': 'lecture', 'Readings': 'lecture', 'Lecture Videos': 'lecture',
    'Recitation Notes': 'recitation', 'Recitation Videos': 'recitation', 'Problem-solving Videos': 'recitation',
    'Problem Sets': 'assignment', 'Assignments': 'assignment',
    'Problem Set Solutions': 'solution', 'Exam Solutions': 'solution',
    'Exams': 'exam', 'Supplemental Exam Materials': 'exam',
}


def get(url, binary=False, timeout=40):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if binary else r.read().decode('utf-8', 'replace')


def dept(slug):
    m = re.match(r'^(res|hst|sts|mas|esd)\b', slug) or re.match(r'^(\d+)', slug)
    return m.group(1) if m else '?'


def chunks_of(text):
    text = re.sub(r'[ \t]+', ' ', re.sub(r'\n{3,}', '\n\n', (text or '').strip()))
    if len(text) <= CHUNK:
        return [text] if len(text) >= 80 else []
    out, cur = [], ''
    for para in re.split(r'\n{2,}', text):
        if len(cur) + len(para) + 2 > CHUNK and cur:
            out.append(cur.strip()); cur = ''
        cur += para + '\n\n'
    if len(cur.strip()) >= 80:
        out.append(cur.strip())
    return out


def pdf_text(data):
    """math-aware extraction via pymupdf (recovers equations)."""
    try:
        import fitz
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=True) as f:
            f.write(data); f.flush()
            d = fitz.open(f.name)
            t = '\n'.join(p.get_text() for p in d); d.close()
            return t
    except Exception:
        return ''


def strip_html(s):
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s or '', flags=re.S | re.I)
    return html.unescape(re.sub(r'<[^>]+>', ' ', s)).strip()


def strip_subtitles(s):
    """SRT/VTT → plain transcript: drop the index/timecode lines, dedup the repeated caption flicker."""
    out, prev = [], None
    for ln in (s or '').splitlines():
        ln = ln.strip()
        if not ln or ln.isdigit() or '-->' in ln or ln.upper().startswith(('WEBVTT', 'NOTE', 'STYLE')):
            continue
        ln = re.sub(r'<[^>]+>', '', ln)  # inline <c>/<i> cue tags
        if ln and ln != prev:
            out.append(ln); prev = ln
    return ' '.join(out)


def resource_urls(slug):
    """MIT adapter: the course sitemap lists every resource/page path."""
    try:
        sm = get(f'{BASE}/courses/{slug}/sitemap.xml')
    except Exception:
        return []
    locs = re.findall(r'<loc>([^<]+)</loc>', sm)
    return [u for u in locs if '/resources/' in u or '/pages/' in u]


def extract_resource(url):
    """MIT adapter: a resource/page → (text, material) via its data.json. CC-only, math-aware."""
    try:
        d = json.loads(get(url.rstrip('/') + '/data.json'))
    except Exception:
        return None
    lic = (d.get('license') or '').lower()
    if lic and 'creativecommons' not in lic and 'cc' not in lic and 'public' not in lic:
        return None  # CC-open only
    mat = next((LRT[t] for t in (d.get('learning_resource_types') or []) if t in LRT), 'reference')
    f, ft = d.get('file') or '', (d.get('file_type') or '').lower()
    fl = f.lower()
    if f and 'pdf' in ft:                                            # documents: psets, exams, solutions, notes
        try:
            text = pdf_text(get(f if f.startswith('http') else BASE + f, binary=True))
        except Exception:
            text = ''
    elif f and ('subrip' in ft or fl.endswith(('.srt', '.vtt'))):   # video courses: the lecture TRANSCRIPT
        try:
            text = strip_subtitles(get(f if f.startswith('http') else BASE + f))  # get() returns str
        except Exception:
            text = ''
        if mat == 'reference':
            mat = 'lecture'                                          # a transcript IS the lecture
    else:                                                            # course PAGES: inline lecture-note HTML
        text = strip_html(d.get('content') or d.get('body') or '')
    return (text, mat) if text and len(text) >= 80 else None


def done_set():
    try:
        out = subprocess.run(['gcloud', 'storage', 'cat', f'{GCS}/_manifest.jsonl'], capture_output=True, text=True, timeout=60).stdout
        return set(json.loads(l)['slug'] for l in out.splitlines() if l.strip())
    except Exception:
        return set()


def main():
    if not os.path.exists(CATALOG):
        sys.exit(f'no catalog at {CATALOG}')
    slugs = [s.strip() for s in open(CATALOG) if s.strip()]
    if DEPTS:
        slugs = [s for s in slugs if dept(s) in DEPTS]
    done = done_set()
    queue = [s for s in slugs if s not in done]
    print(f'# ocw-resource-capture — {len(slugs)} catalog · {len(done)} done · {len(queue)} queued · → {GCS}', flush=True)
    n = 0
    for slug in queue:
        if LIMIT and n >= LIMIT:
            break
        n += 1
        rows = []
        for url in resource_urls(slug):
            r = extract_resource(url)
            if r:
                text, mat = r
                for ci, c in enumerate(chunks_of(text)):
                    rows.append({'text': c, 'slug': f'{slug}-{len(rows)}', 'field': 'ocw', 'material': mat, 'source': slug})
            time.sleep(DELAY)
        status = 'ok' if rows else 'empty'
        if rows:
            with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False) as tf:
                for r in rows:
                    tf.write(json.dumps(r) + '\n')
                tmp = tf.name
            subprocess.run(['gcloud', 'storage', 'cp', tmp, f'{GCS}/courses/{slug}.jsonl'], capture_output=True, timeout=120)
            os.unlink(tmp)
        # append to the resumable manifest
        subprocess.run(['bash', '-c', f"echo '{json.dumps({'slug': slug, 'status': status, 'chunks': len(rows)})}' | gcloud storage cp - {GCS}/_manifest_{slug}.jsonl"], capture_output=True, timeout=60)
        print(f'  {"OK " if rows else "·  "} {slug} — {len(rows)} chunks', flush=True)
        time.sleep(DELAY)
    print(f'# done — {n} courses this run. (concat _manifest_*.jsonl → _manifest.jsonl for resume index)', flush=True)


if __name__ == '__main__':
    main()
