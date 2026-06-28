#!/usr/bin/env python3
"""chunk-corpus — the parametrized, material-aware chunker for brain v1 (Stage 1, no GPU). One chunker is wrong
for this corpus: psets/exams/solutions are discrete numbered problems, notes/transcripts are prose. So we route
by material, sweep overlap, and switch the transcript strategy — to A/B which config gives the best retrieval,
then build the full brain ONCE with the winner.

  CHUNK_MODE     transcript/prose strategy: 'sliding' (window+overlap) | 'semantic' (topic-shift boundaries)
  CHUNK_OVERLAP  sentence-aware overlap fraction (0.0 | 0.15 | 0.30). 0 = no overlap.
  CHUNK_TARGET   target chunk chars (default 1500)   CHUNK_MAX  hard re-chunk ceiling (default 2200)
  CHUNK_HEADING  prefix each chunk with "[<course> · <material>] " for context+continuity (default 1)

  CHUNK_MODE=semantic CHUNK_OVERLAP=0.15 python3 scripts/chunk-corpus.py <in_dir> <out_dir>

Gold (solution/assignment/exam) → split per PROBLEM (keep each problem whole; sub-split only if huge).
Prose (lecture/reference)       → 'sliding': pack sentences to TARGET with N overlap sentences;
                                  'semantic': cut where adjacent-sentence similarity drops (MiniLM, local/cheap).
Then: strip MITOCW headers, drop junk(�)/tiny, global exact-dedup, map slug→department field.
"""
import sys, os, re, json, hashlib, glob, unicodedata
from collections import defaultdict

MODE     = os.environ.get('CHUNK_MODE', 'sliding')           # sliding | semantic
OVERLAP  = float(os.environ.get('CHUNK_OVERLAP', '0.15'))    # sentence-aware overlap fraction
TARGET   = int(os.environ.get('CHUNK_TARGET', '1500'))
HARD_MAX = int(os.environ.get('CHUNK_MAX', '2200'))
HEADING  = os.environ.get('CHUNK_HEADING', '1') == '1'
MIN_CHARS = 80
SEM_THRESHOLD = float(os.environ.get('CHUNK_SEM_THRESHOLD', '0.55'))  # cut when adj-sentence cos < this

DEPT_FIELD = {
    '1': 'civil_environmental_eng', '2': 'mechanical_eng', '3': 'materials_science', '4': 'architecture',
    '5': 'chemistry', '6': 'eecs', '7': 'biology', '8': 'physics', '9': 'brain_cognitive_science',
    '10': 'chemical_eng', '11': 'urban_studies', '12': 'earth_planetary', '14': 'economics', '15': 'management',
    '16': 'aero_astro', '17': 'political_science', '18': 'mathematics', '20': 'biological_eng', '21': 'humanities',
    '22': 'nuclear_science', '24': 'linguistics_philosophy', 'hst': 'medicine', 'res': 'supplemental',
    'sts': 'science_tech_society', 'mas': 'media_arts', 'esd': 'systems_engineering',
}
def dept(slug):
    m = re.match(r'^(res|hst|sts|mas|esd)\b', slug) or re.match(r'^(\d+)', slug)
    return m.group(1) if m else '?'
def field_of(slug):
    return DEPT_FIELD.get(dept(slug), f'dept_{dept(slug)}')
def course_title(slug):
    # "18-06-linear-algebra-spring-2010" → "18.06 linear algebra"
    m = re.match(r'^([0-9a-z]+)-([0-9a-z]+)-(.+?)-(spring|fall|summer|january|iap)', slug)
    if m:
        return f'{m.group(1)}.{m.group(2)} ' + m.group(3).replace('-', ' ')
    return slug.replace('-', ' ')

_HDR = re.compile(r'^\s*MITOCW\s*\|\s*\S+\s*\n?', re.I)
_SENT = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9$\\])')
# problem delimiters for gold materials (Problem 1 / Exercise 2 / Part (a) / 3. ...)
_PROB = re.compile(r'(?im)^\s*(?:problem|exercise|question|part|q)\s*[\#\.]?\s*\d+|^\s*\d{1,2}[\.\)]\s+(?=[A-Z(])')

_CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')   # control chars (PDF artifacts) — keep \n \t
def normalize_text(t):
    """NFKC (ligatures ﬁ→fi, full-width→ascii), drop control chars + soft hyphens, collapse runs of spaces.
    These PDF-extraction artifacts (\\x12\\x13 runs, ﬁ/ﬂ ligatures, \\xad) silently degrade embeddings."""
    t = unicodedata.normalize('NFKC', t or '')
    t = _CTRL.sub(' ', t).replace('\xad', '')
    t = re.sub(r'[ \t]{2,}', ' ', t)
    return t

def strip_header(t):
    return _HDR.sub('', normalize_text(t), count=1).strip()

def sentences(text):
    return [s for s in _SENT.split(text) if s.strip()]

def pack_sliding(sents, target, overlap_frac):
    """Pack sentences into ~target-char chunks; carry the trailing overlap_frac of sentences into the next."""
    chunks, cur = [], []
    cur_len = 0
    for s in sents:
        cur.append(s); cur_len += len(s) + 1
        if cur_len >= target:
            chunks.append(' '.join(cur).strip())
            keep = max(1, int(len(cur) * overlap_frac)) if overlap_frac > 0 else 0
            cur = cur[len(cur) - keep:] if keep else []
            cur_len = sum(len(x) + 1 for x in cur)
    if cur and ' '.join(cur).strip():
        chunks.append(' '.join(cur).strip())
    return chunks

def pack_semantic(sents, target, overlap_frac, model):
    """Cut where adjacent-sentence similarity drops (topic shift), capped at target; small overlap carried."""
    if len(sents) < 2:
        return [' '.join(sents).strip()] if sents else []
    import numpy as np
    emb = model.encode(sents, normalize_embeddings=True, show_progress_bar=False, batch_size=128)
    chunks, cur, cur_len = [], [], 0
    for i, s in enumerate(sents):
        cur.append(s); cur_len += len(s) + 1
        drop = (i + 1 < len(sents)) and float(emb[i] @ emb[i + 1]) < SEM_THRESHOLD
        if cur_len >= target or (drop and cur_len > target * 0.5):
            chunks.append(' '.join(cur).strip())
            keep = max(1, int(len(cur) * overlap_frac)) if overlap_frac > 0 else 0
            cur = cur[len(cur) - keep:] if keep else []
            cur_len = sum(len(x) + 1 for x in cur)
    if cur and ' '.join(cur).strip():
        chunks.append(' '.join(cur).strip())
    return chunks

def chunk_problems(text):
    """Gold: split on problem delimiters; each problem a chunk. Sub-split a huge problem by sentences."""
    idxs = [m.start() for m in _PROB.finditer(text)]
    if len(idxs) < 2:
        return None   # no clear problem structure → caller falls back to prose
    idxs.append(len(text))
    pieces = []
    for a, b in zip(idxs, idxs[1:]):
        seg = text[a:b].strip()
        if len(seg) <= HARD_MAX:
            pieces.append(seg)
        else:
            pieces.extend(pack_sliding(sentences(seg), TARGET, OVERLAP))
    return [p for p in pieces if p.strip()]

def main():
    in_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    model = None
    if MODE == 'semantic':
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')   # boundary detection only (cheap)
    seen, by_field = set(), defaultdict(list)
    st = defaultdict(int)
    for fp in sorted(glob.glob(os.path.join(in_dir, '*.jsonl'))):
        slug = os.path.basename(fp)[:-6]; field = field_of(slug); title = course_title(slug)
        st['courses'] += 1
        for line in open(fp, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            st['in_chunks'] += 1
            t = strip_header(r.get('text', '') or '')
            if '�' in t:
                st['junk'] += 1; continue
            material = (r.get('material') or 'reference').lower()
            if material in ('solution', 'assignment', 'exam'):
                pieces = chunk_problems(t)
                if pieces is None:
                    pieces = (pack_semantic if MODE == 'semantic' else pack_sliding)(
                        sentences(t), TARGET, OVERLAP, *( [model] if MODE == 'semantic' else [] ))
                else:
                    st['problem_split'] += 1
            else:  # prose: lecture / reference / etc.
                if len(t) <= TARGET:
                    pieces = [t]
                elif MODE == 'semantic':
                    pieces = pack_semantic(sentences(t), TARGET, OVERLAP, model)
                else:
                    pieces = pack_sliding(sentences(t), TARGET, OVERLAP)
            prefix = f'[{title} · {material}] ' if HEADING else ''
            for p in pieces:
                body = p.strip()
                if len(body) < MIN_CHARS:
                    st['tiny'] += 1; continue
                h = hashlib.md5(re.sub(r'\s+', ' ', body).strip().lower().encode()).hexdigest()
                if h in seen:
                    st['dupes'] += 1; continue
                seen.add(h)
                by_field[field].append({'text': prefix + body, 'slug': slug, 'field': field, 'material': material})
                st['out'] += 1
    for field, rows in by_field.items():
        with open(os.path.join(out_dir, f'{field}.jsonl'), 'w', encoding='utf-8') as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
    cfg = f'mode={MODE} overlap={OVERLAP} target={TARGET} heading={HEADING}'
    print(f"# chunk-corpus [{cfg}]")
    print(f"  courses={st['courses']} in={st['in_chunks']} problem-split={st['problem_split']} "
          f"dupes={st['dupes']} tiny={st['tiny']} junk={st['junk']} → OUT={st['out']} ({len(by_field)} fields)")
    json.dump({'config': cfg, **st}, open(os.path.join(out_dir, '_chunk-stats.json'), 'w'), indent=2)

if __name__ == '__main__':
    main()
