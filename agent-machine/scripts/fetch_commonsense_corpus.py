#!/usr/bin/env python3
"""
fetch_commonsense_corpus — the EVERYDAY / world-knowledge brain: CSKG + ConceptNet + DBpedia, at FULL
scale (no sampling). This is the substrate the everyday/household lane was always missing — we built the
routing (deEscalateEveryday, the life-domain tagger) but never gave it a knowledge corpus to ground on.

Sources (each fault-tolerant — a dead URL skips, never sinks the run):
  CSKG        the consolidated CommonSense Knowledge Graph (2.2M nodes / 6M edges) — itself a merge of
              ConceptNet + ATOMIC + WordNet + FrameNet + Roget + Visual Genome + Wikidata-CS.
  CONCEPTNET  ConceptNet 5.7 assertions (~34M edges, all languages; CS_LANG=en to narrow).
  DBPEDIA     DBpedia English abstracts (~4.9M entities) — encyclopedic world facts, one chunk per entity.

SCALE is the whole problem: 40M+ edges. We do NOT hold them in RAM. Each KG source streams edges to a temp
file as `node<TAB>statement`, then GNU `sort` (disk-backed, LC_ALL=C) groups them by node, and we emit one
grouped chunk per concept ("coffee:\n- is a: beverage\n- used for: waking up\n…") — so retrieval gets all
facts about a concept together, and memory stays bounded at any size. DBpedia abstracts are already
per-entity prose, so they emit directly.

Knowledge ≠ advice: the life-domain tagger still attaches disclaimers at answer time where relevant.

Run (needs GNU coreutils `sort`; no GPU — this is the FETCH/STAGE step, vectorize is a separate pass):
  python3 scripts/fetch_commonsense_corpus.py
  OCW_BRAIN        brain dir (default ~/Downloads/MIT OCW/_brain)
  CS_LIMIT         cap emitted chunks per source (0 = ALL, the default)
  CS_CHUNK         max chars per grouped chunk (default 1500)
  CS_LANG          ConceptNet language filter, e.g. en (default '' = all languages)
  CS_SOURCES       comma list of sources to run (default cskg,conceptnet,dbpedia)
  CSKG_URL / CONCEPTNET_URL / DBPEDIA_URL    override the download URLs
  CS_TMP           scratch dir for downloads + sort (default $TMPDIR/noetica-cs)
"""
import os, sys, re, json, gzip, bz2, io, html, shutil, subprocess, urllib.request, collections

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
CS_DIR = os.path.join(BRAIN, 'commonsense')
LIMIT = int(os.environ.get('CS_LIMIT', '0'))
CHUNK = int(os.environ.get('CS_CHUNK', '1500'))
LANG = os.environ.get('CS_LANG', '').strip().lower()
SOURCES = [s.strip() for s in os.environ.get('CS_SOURCES', 'cskg,conceptnet,dbpedia').split(',') if s.strip()]
TMP = os.environ.get('CS_TMP', os.path.join(os.environ.get('TMPDIR', '/tmp'), 'noetica-cs'))
CSKG_URL = os.environ.get('CSKG_URL', 'https://zenodo.org/records/4331372/files/cskg.tsv.gz')
CONCEPTNET_URL = os.environ.get('CONCEPTNET_URL',
                                'https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz')
DBPEDIA_URL = os.environ.get('DBPEDIA_URL',
                             'https://downloads.dbpedia.org/repo/dbpedia/text/short-abstracts/2022.12.01/short-abstracts_lang=en.ttl.bzip2')


def chunks_of(text, size=None):
    size = size or CHUNK
    text = re.sub(r'[ \t]+', ' ', (text or '').strip())
    if len(text) <= size:
        return [text] if len(text) >= 40 else []
    out, cur = [], ''
    for line in text.split('\n'):
        if len(cur) + len(line) + 1 > size and cur:
            out.append(cur.strip()); cur = ''
        cur += line + '\n'
    if len(cur.strip()) >= 40:
        out.append(cur.strip())
    return out


def download(url, dest):
    """Stream a (possibly multi-GB) file to disk — never into memory."""
    req = urllib.request.Request(url, headers={'User-Agent': 'noetica-commonsense-fetch'})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, 'wb') as out:
        shutil.copyfileobj(r, out, 1 << 20)
    return dest


def opener(path):
    """Transparent reader for .gz / .bz2 / plain, text mode."""
    if path.endswith('.gz'):
        return gzip.open(path, 'rt', encoding='utf-8', errors='replace')
    if path.endswith('.bz2') or path.endswith('.bzip2'):
        return bz2.open(path, 'rt', encoding='utf-8', errors='replace')
    return open(path, 'rt', encoding='utf-8', errors='replace')


def term_label(uri):
    # /c/en/wake_up/n/wn/... → "wake up"
    parts = uri.split('/')
    term = parts[3] if len(parts) > 3 else parts[-1]
    return term.replace('_', ' ').strip()


def rel_label(uri):
    # /r/UsedFor → "used for"
    r = uri.split('/')[-1]
    return re.sub(r'(?<!^)(?=[A-Z])', ' ', r).lower().strip()


# ── streaming edge producers: yield (node, statement) ──────────────────────────────────────────────────
def conceptnet_edges(path):
    for line in opener(path):
        p = line.rstrip('\n').split('\t')
        if len(p) < 4:
            continue
        rel, start, end = p[1], p[2], p[3]
        if LANG and not (start.startswith(f'/c/{LANG}/') and end.startswith(f'/c/{LANG}/')):
            continue
        stmt = ''
        if len(p) > 4:
            try:
                surf = json.loads(p[4]).get('surfaceText') or ''
                stmt = re.sub(r'\[\[|\]\]', '', surf).strip()
            except Exception:
                stmt = ''
        if not stmt:
            stmt = f"{rel_label(rel)}: {term_label(end)}"
        yield term_label(start), stmt


def cskg_edges(path):
    rdr = opener(path)
    header = rdr.readline().rstrip('\n').split('\t')
    idx = {h: i for i, h in enumerate(header)}
    n1, n2 = idx.get('node1;label', idx.get('node1')), idx.get('node2;label', idx.get('node2'))
    rl, sent = idx.get('relation;label', idx.get('relation')), idx.get('sentence')
    for line in rdr:
        c = line.rstrip('\n').split('\t')
        try:
            node = (c[n1] if n1 is not None and c[n1] else '').split('|')[0].strip()
            if not node:
                continue
            if sent is not None and len(c) > sent and c[sent].strip():
                stmt = c[sent].strip()
            else:
                stmt = f"{(c[rl] if rl is not None else '').split('|')[0]}: {(c[n2] if n2 is not None else '').split('|')[0]}".strip()
            if stmt:
                yield node, stmt
        except Exception:
            continue


def stage_grouped(material, edge_iter):
    """Stream edges → external-sort by node → emit one grouped chunk per concept. Memory-bounded at any scale."""
    os.makedirs(TMP, exist_ok=True)
    raw = os.path.join(TMP, f"{material}.edges.tsv")
    n_edges = 0
    with open(raw, 'w', encoding='utf-8') as f:
        for node, stmt in edge_iter:
            node = node.replace('\t', ' ').replace('\n', ' ').strip()
            stmt = stmt.replace('\t', ' ').replace('\n', ' ').strip()
            if node and stmt:
                f.write(f"{node}\t{stmt}\n"); n_edges += 1
    print(f"  {material}: streamed {n_edges} edges → sorting (disk-backed) …", flush=True)
    srt = raw + '.sorted'
    subprocess.run(['sort', '-t', '\t', '-k1,1', '-S', '1G', '-o', srt, raw],
                   check=True, env={**os.environ, 'LC_ALL': 'C'})
    out_path = os.path.join(CS_DIR, f"{material}.jsonl")
    written, cur_node, lines = 0, None, []

    def flush(node, lines):
        nonlocal written
        if not node or not lines:
            return 0
        text = node + ':\n' + '\n'.join(f"- {l}" for l in lines)
        c = 0
        for ci, ch in enumerate(chunks_of(text)):
            out.write(json.dumps({'text': ch, 'slug': f"{material}-{re.sub(r'[^a-z0-9]+', '-', node.lower())[:60]}-{ci}",
                                  'field': 'commonsense', 'material': material, 'source': material}) + '\n')
            c += 1
        return c

    with open(out_path, 'w', encoding='utf-8') as out, open(srt, encoding='utf-8') as f:
        for line in f:
            node, _, stmt = line.rstrip('\n').partition('\t')
            if node != cur_node:
                written += flush(cur_node, lines)
                if LIMIT and written >= LIMIT:
                    cur_node, lines = None, []
                    break
                cur_node, lines = node, []
            lines.append(stmt)
        written += flush(cur_node, lines)
    print(f"# {material}: wrote {written} grouped chunks → {out_path}", flush=True)
    for p in (raw, srt):
        try: os.remove(p)
        except OSError: pass
    return written


def stage_dbpedia(path):
    """DBpedia abstracts are already per-entity prose — one chunk per entity, no grouping."""
    out_path = os.path.join(CS_DIR, 'dbpedia.jsonl')
    written = 0
    pat = re.compile(r'<http://dbpedia\.org/resource/([^>]+)>\s+<[^>]*abstract>\s+"(.*)"@en')
    with open(out_path, 'w', encoding='utf-8') as out:
        for line in opener(path):
            m = pat.match(line)
            if not m:
                continue
            ent = m.group(1).replace('_', ' ')
            text = html.unescape(m.group(2)).replace('\\"', '"').replace('\\n', ' ').strip()
            for ci, ch in enumerate(chunks_of(f"{ent}: {text}")):
                out.write(json.dumps({'text': ch, 'slug': f"dbpedia-{re.sub(r'[^a-z0-9]+', '-', ent.lower())[:60]}-{ci}",
                                      'field': 'commonsense', 'material': 'dbpedia', 'source': 'dbpedia-abstract'}) + '\n')
                written += 1
            if LIMIT and written >= LIMIT:
                break
    print(f"# dbpedia: wrote {written} abstract chunks → {out_path}", flush=True)
    return written


def run_source(name):
    os.makedirs(TMP, exist_ok=True)
    if name == 'cskg':
        print(f"# CSKG ← {CSKG_URL}", flush=True)
        p = download(CSKG_URL, os.path.join(TMP, 'cskg.tsv.gz'))
        return stage_grouped('cskg', cskg_edges(p))
    if name == 'conceptnet':
        print(f"# ConceptNet ← {CONCEPTNET_URL} (lang={LANG or 'all'})", flush=True)
        p = download(CONCEPTNET_URL, os.path.join(TMP, 'conceptnet.csv.gz'))
        return stage_grouped('conceptnet', conceptnet_edges(p))
    if name == 'dbpedia':
        print(f"# DBpedia ← {DBPEDIA_URL}", flush=True)
        ext = '.bz2' if 'bz' in DBPEDIA_URL else '.gz' if DBPEDIA_URL.endswith('.gz') else '.ttl'
        p = download(DBPEDIA_URL, os.path.join(TMP, 'dbpedia-abstracts' + ext))
        return stage_dbpedia(p)
    print(f"  ! unknown source '{name}' — skipped", flush=True)
    return 0


def main():
    os.makedirs(CS_DIR, exist_ok=True)
    total = 0
    for name in SOURCES:
        try:
            total += run_source(name)
        except Exception as e:
            print(f"  ! {name} skipped: {type(e).__name__} {str(e)[:160]}", flush=True)
    print(f"# done — {total} commonsense chunks staged (sources={','.join(SOURCES)}, limit={LIMIT or 'ALL'}). "
          f"NEXT: vectorize_field.py commonsense", flush=True)


if __name__ == '__main__':
    main()
