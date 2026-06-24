#!/usr/bin/env python3
"""
build-notecard — the EXAM NOTE CARD. In a college exam you don't get the textbook; you get a curated formula
sheet to bring in. So should the model. Instead of grounding only on noisy retrieved chunks, we extract the
canonical EQUATIONS & FORMULAS per domain from the (equations-recovered, v4) brain into a compact, curated card:
dense, complete, authoritative, STABLE (same card every time). This is only possible post-v4 — pre-v4 the math
was `�` junk that pypdf shredded; pymupdf recovered it, so the formulas are finally there to mine.

The card complements brain-grounded compute (#12): worked solutions are the studied examples; the card is the
formula sheet. A real open-book exam gives you both.

Per field: scan gold + lecture material → pull formula-like lines → normalize + dedupe + rank by frequency
(canonical formulas recur across courses) → top-N → notecard-<field>.md. Grounds (1) the compute formalizer
and (2) a `notecard` open-book bench arm.

Run:  OCW_BRAIN=… python3 scripts/build-notecard.py [field ...]
  NOTECARD_TOP   formulas/card (default 40)     NOTECARD_DIR  out dir (default ~/.noetica/notecards)
"""
import os, sys, re, json, collections

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
OUT = os.path.expanduser(os.environ.get('NOTECARD_DIR', '~/.noetica/notecards'))
TOP = int(os.environ.get('NOTECARD_TOP', '40'))
# the formula sheet is built from the material that STATES the laws/methods (not the prose lecture transcript)
MATERIAL = {'reference', 'lecture', 'solution', 'exam', 'assignment', 'recitation'}
FIELDS = sys.argv[1:] or ([d for d in sorted(os.listdir(BRAIN)) if os.path.isdir(os.path.join(BRAIN, d))] if os.path.isdir(BRAIN) else [])

_MATH = re.compile(r'[=≈≤≥∝→±∓∫∑∏√∂∇πθλμσΩωαβγδ·×÷]|\^|_\{|\\frac|\\sqrt|\\int|\\sum|\\partial|\\nabla')
_PROSE = re.compile(r'\b(the|this|that|which|where|when|therefore|because|however|example|problem|figure|chapter|section|course|lecture)\b', re.I)


def is_formula(s):
    """A formula line: short, has a relation (=, ∝, →) + math symbols, isn't a sentence."""
    s = s.strip()
    if len(s) < 4 or len(s) > 140:
        return False
    if not re.search(r'[=∝→≈≤≥]', s):          # must assert a relation
        return False
    if not _MATH.search(s):
        return False
    words = re.findall(r'[A-Za-z]{4,}', s)
    if len(words) > 9 or len(_PROSE.findall(s)) >= 3:   # too prose-y → it's a sentence, not a formula
        return False
    if not re.search(r'[A-Za-z]', s):           # need at least one variable
        return False
    return True


def normalize(f):
    return re.sub(r'\s+', '', f.lower())


def field_card(field):
    d = os.path.join(BRAIN, field)
    if not os.path.isdir(d):
        return [], 0
    counter, examples, scanned = collections.Counter(), {}, 0
    for fn in os.listdir(d):
        if not fn.endswith('.jsonl'):
            continue
        for ln in open(os.path.join(d, fn), errors='replace'):
            try:
                o = json.loads(ln)
            except Exception:
                continue
            if o.get('material') not in MATERIAL:
                continue
            scanned += 1
            for line in (o.get('text') or '').splitlines():
                if is_formula(line):
                    k = normalize(line)
                    if 4 <= len(k) <= 120:
                        counter[k] += 1
                        examples.setdefault(k, line.strip())
    # canonical formulas recur → frequency-rank; require it appear ≥2× (a one-off is likely OCR noise)
    top = [examples[k] for k, c in counter.most_common() if c >= 2][:TOP]
    return top, scanned


def main():
    if not os.path.isdir(BRAIN):
        sys.exit(f'no brain at {BRAIN}')
    os.makedirs(OUT, exist_ok=True)
    for field in FIELDS:
        top, scanned = field_card(field)
        if not top:
            print(f'  {field:16} no formulas (scanned {scanned} chunks — pre-v4 brain, or non-mathematical field)')
            continue
        path = os.path.join(OUT, f'notecard-{field}.md')
        with open(path, 'w') as f:
            f.write(f'# {field} — exam note card ({len(top)} canonical formulas, frequency-ranked)\n\n')
            for i, formula in enumerate(top, 1):
                f.write(f'{i}. {formula}\n')
        print(f'  {field:16} {len(top)} formulas → {path}')
    print(f'\n# note cards → {OUT}  (ground the compute formalizer + a `notecard` open-book arm)')


if __name__ == '__main__':
    main()
