#!/usr/bin/env python3
"""clean-corpus-v1 — Stage 1 of the CLEAN brain v1 build (no GPU, no spend). The 2,518 OCW captures are already
pymupdf-clean text (0 replacement-char junk) and pre-chunked, but carry three defects we will NOT vectorize
into the brain: (1) MITOCW transcript header lines, (2) oversized chunks (transcript segments up to ~36k chars —
one vector for 36k chars destroys retrieval granularity), (3) ~4-5% exact duplicates. This pass fixes all three,
maps each course to its department field, and emits per-field clean chunks ready for Stage-2 embedding. Verify the
stats it prints BEFORE spending a dollar of GPU.

  python3 scripts/clean-corpus-v1.py <in_dir_of_course_jsonl> <out_dir>
  (in_dir = a local folder of <slug>.jsonl files pulled from gs://…/knowledge-commons/courseware/mit/courses/)
"""
import sys, os, re, json, hashlib, glob
from collections import defaultdict

TARGET = 1500          # re-chunk oversized to ~this (matches the capture's OCW_CHUNK); split on sentence bounds
HARD_MAX = 2200        # anything longer than this gets re-chunked
MIN_CHARS = 80         # drop chunks shorter than this (nav scraps)

# MIT course number → brain field name (STEM names match the board's SUBJECT_FIELDS; others keep a stable name).
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

_HDR = re.compile(r'^\s*MITOCW\s*\|\s*\S+\s*\n?', re.I)          # transcript header line
_SENT = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9])')                # sentence-ish boundary for re-chunking
def strip_header(t):
    return _HDR.sub('', t, count=1).strip()

def rechunk(text):
    """Split an oversized chunk into ~TARGET-char pieces on sentence boundaries (no mid-sentence cuts)."""
    if len(text) <= HARD_MAX:
        return [text]
    out, cur = [], ''
    for sent in _SENT.split(text):
        if cur and len(cur) + len(sent) + 1 > TARGET:
            out.append(cur.strip()); cur = sent
        else:
            cur = f'{cur} {sent}'.strip()
    if cur.strip():
        out.append(cur.strip())
    # a single monster sentence with no breaks → hard-wrap at TARGET
    final = []
    for c in out:
        while len(c) > HARD_MAX:
            final.append(c[:TARGET]); c = c[TARGET:]
        final.append(c)
    return [c for c in final if c.strip()]

def main():
    in_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(in_dir, '*.jsonl')))
    seen = set()                                   # global exact-dedup over normalized text
    by_field = defaultdict(list)
    stats = {'courses': 0, 'in_chunks': 0, 'out_chunks': 0, 'dupes': 0, 'rechunked': 0, 'tiny': 0, 'junk': 0}
    for fp in files:
        slug = os.path.basename(fp)[:-6]
        field = field_of(slug)
        stats['courses'] += 1
        for line in open(fp, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            stats['in_chunks'] += 1
            t = strip_header(r.get('text', '') or '')
            if '�' in t:                       # replacement-char junk → drop (shouldn't happen w/ pymupdf)
                stats['junk'] += 1; continue
            pieces = rechunk(t)
            if len(pieces) > 1:
                stats['rechunked'] += 1
            for p in pieces:
                if len(p) < MIN_CHARS:
                    stats['tiny'] += 1; continue
                h = hashlib.md5(re.sub(r'\s+', ' ', p).strip().lower().encode()).hexdigest()
                if h in seen:
                    stats['dupes'] += 1; continue
                seen.add(h)
                by_field[field].append({'text': p, 'slug': slug, 'field': field,
                                        'material': (r.get('material') or 'reference').lower()})
                stats['out_chunks'] += 1
    for field, rows in by_field.items():
        with open(os.path.join(out_dir, f'{field}.jsonl'), 'w', encoding='utf-8') as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')

    print("=" * 60)
    print("CLEAN-CORPUS v1 — Stage 1 (no GPU)")
    print("=" * 60)
    print(f"  courses processed : {stats['courses']}")
    print(f"  chunks in         : {stats['in_chunks']}")
    print(f"  → re-chunked oversized : {stats['rechunked']}")
    print(f"  → dropped dupes        : {stats['dupes']}")
    print(f"  → dropped tiny (<{MIN_CHARS}c) : {stats['tiny']}")
    print(f"  → dropped junk (�)        : {stats['junk']}")
    print(f"  CLEAN chunks out  : {stats['out_chunks']}  ({len(by_field)} fields)")
    print(f"\n  fields: " + ', '.join(f'{k}={len(v)}' for k, v in sorted(by_field.items(), key=lambda x: -len(x[1]))))
    print(f"\n# → {out_dir}/<field>.jsonl  — ready for Stage-2 embed (nomic-embed-text 768d)")
    json.dump(stats, open(os.path.join(out_dir, '_clean-stats.json'), 'w'), indent=2)

if __name__ == '__main__':
    main()
