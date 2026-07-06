#!/usr/bin/env python3
"""
brain-dedup-clean — apply the corpus-quality fixes the comparison surfaced.

DEDUP (default): drop duplicate chunks (keep the FIRST by normalized-text hash) — the ~11% near-dup debt
(vs ~0 in industrially-deduped corpora). A real, safe win.

JUNK is REPORTED but NOT scrubbed unless CLEAN=1 — on purpose. The `�` (U+FFFD) marks MATH that pypdf failed
to extract (see memory: project_ocw_pdf_extraction_junk). Stripping it *erases* the equation; the right fix
is re-extracting with a math-aware parser (pymupdf/Nougat/Marker), which *recovers* it. So default is
dedup-only; we don't scrub math before the proper re-extraction.

Vectors preserved (dedup removes whole chunks; clean only touches injected text). Atomic + idempotent.

Run:  OCW_BRAIN=… python3 scripts/brain-dedup-clean.py [field ...]    (default: every field)
  DRY=1    measure only, don't write
  CLEAN=1  also strip U+FFFD/control junk (STOPGAP — see memory; loses math)
"""
import os, sys, re, json, hashlib

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
DRY = os.environ.get('DRY') == '1'
CLEAN = os.environ.get('CLEAN') == '1'
FIELDS = sys.argv[1:] or ([d for d in sorted(os.listdir(BRAIN)) if os.path.isdir(os.path.join(BRAIN, d))] if os.path.isdir(BRAIN) else [])

_ws = re.compile(r'\s+')
# Delete C0 control chars except tab/LF/CR (str.translate table — avoids a regex control range).
_CTRL_DEL = dict.fromkeys(c for c in range(0x20) if c not in (0x09, 0x0a, 0x0d))


def norm(t):
    return _ws.sub(' ', t.lower()).strip()


def clean(t):
    return _ws.sub(' ', t.replace('�', ' ').translate(_CTRL_DEL)).strip() if t else t


def process(field):
    d = os.path.join(BRAIN, field)
    if not os.path.isdir(d):
        return (0, 0, 0)
    seen = set()
    tot = drop = junk = 0
    for fn in sorted(f for f in os.listdir(d) if f.endswith('.jsonl') and not f.endswith('.dctmp')):
        fp = os.path.join(d, fn)
        kept = []
        for ln in open(fp, errors='replace'):
            ln = ln.strip()
            if not ln:
                continue
            try:
                o = json.loads(ln)
            except Exception:
                continue
            tot += 1
            t = o.get('text') or ''
            h = hashlib.md5(norm(t).encode('utf-8', 'replace')).hexdigest()
            if h in seen:
                drop += 1
                continue
            seen.add(h)
            if '�' in t:
                junk += 1
            if CLEAN:
                o['text'] = clean(t)
            kept.append(o)
        if not DRY:
            tmp = fp + '.dctmp'
            with open(tmp, 'w') as w:
                for o in kept:
                    w.write(json.dumps(o) + '\n')
            os.replace(tmp, fp)
    return (tot, drop, junk)


def main():
    mode = 'DRY' if DRY else ('dedup+clean' if CLEAN else 'dedup-only')
    print(f"# brain-dedup-clean [{mode}] · {BRAIN}", flush=True)
    gt = gd = gj = 0
    for field in FIELDS:
        tot, drop, junk = process(field)
        if tot:
            print(f"  {field:16} {tot:>8} -> {tot - drop:>8}  (-{drop} dups {100 * drop / tot:.1f}%, {junk} chunks carry math-loss junk)", flush=True)
            gt += tot; gd += drop; gj += junk
    print(f"# TOTAL {gt} -> {gt - gd}  (removed {gd} dups = {100 * gd / max(gt, 1):.1f}%; {gj} chunks carry the math-extraction junk -> real fix is re-extract, see memory){' [dry]' if DRY else ''}", flush=True)


if __name__ == '__main__':
    main()
