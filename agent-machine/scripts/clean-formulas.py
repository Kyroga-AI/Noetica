#!/usr/bin/env python3
"""
clean-formulas — FUZZY-LINK + CLASSIFY our noisy PDF-extracted formulas onto the canonical equation artifacts
(canon/canonical-equations.json, seeded from the AP/SAT formula sheets). The Alexandrian Academy cleanup:

  noisy brain fragment  ──fuzzy-link (CPU signature match)──▶  canonical equation  ──▶  clean form + topic
  no canonical match  ──▶  DROPPED as noise (NMR tables, `i=1 i=1`, page artifacts)

This does two jobs from one pass:
  1. NOTE CARD — the canonical equations VALIDATED as present in our corpus (≥MIN_HITS links), clean + by topic,
     plus a COVERAGE report (which canonical formulas our brain actually has).
  2. CORPUS CLEANUP — the link map {noisy fragment → canonical equation id} that lets us clean the GOLDEN corpus
     (annotate/replace mangled formulas with their canonical form).

Linking is CPU token/signature matching (fast, deterministic, no GPU — the keyed-vecs spirit); embeddings are an
optional tiebreaker (LINK_EMBED=1). Parse-gate + recall threshold reject the noise.

Run:  OCW_BRAIN=… python3 scripts/clean-formulas.py [field ...]
  LINK_THRESH   min signature recall to link (default 0.6)     MIN_HITS  links to keep a canon eq on the card (default 1)
  NOTECARD_DIR  out dir (default ~/.noetica/notecards)         CANON  path to canonical-equations.json
"""
import os, sys, re, json, collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
CANON = os.environ.get('CANON', os.path.join(HERE, 'canon', 'canonical-equations.json'))
OUT = os.path.expanduser(os.environ.get('NOTECARD_DIR', '~/.noetica/notecards'))
THRESH = float(os.environ.get('LINK_THRESH', '0.6'))
MIN_HITS = int(os.environ.get('MIN_HITS', '1'))
MATERIAL = {'reference', 'lecture', 'solution', 'exam', 'assignment', 'recitation'}

canon = json.load(open(CANON))
FUNCS = {'sqrt', 'sum', 'integral', 'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'lim', 'pi'}
_MATH = re.compile(r'[=≈≤≥∝→±∓∫∑∏√∂∇πθλμσ]|\^|_\{|\\frac|\\sqrt|\\int|\\sum')
_PROSE = re.compile(r'\b(the|this|that|which|where|when|therefore|because|however|example|problem|figure|chapter|course|lecture)\b', re.I)


def is_formula(s):
    s = s.strip()
    if len(s) < 4 or len(s) > 140 or not re.search(r'[=∝→≈≤≥]', s) or not _MATH.search(s):
        return False
    if len(re.findall(r'[A-Za-z]{4,}', s)) > 9 or len(_PROSE.findall(s)) >= 3:
        return False
    return bool(re.search(r'[A-Za-z]', s))


def signature(s):
    """Variable letters + function names that define the equation's identity (ignore bare operators/numbers)."""
    s = re.sub(r'[!⃗`*]', ' ', s.lower())
    sig = set()
    for m in re.findall(r'[a-z]+', s):
        if m in FUNCS:
            sig.add(m)
        elif len(m) <= 2:           # single/double-letter variable (x, dt, pe…)
            sig.add(m)
    return sig


# precompute canonical signatures
for dom, eqs in canon.items():
    if dom.startswith('_'):
        continue
    for eq in eqs:
        eq['_sig'] = signature(eq['form']) | {w.lower() for kw in eq.get('keywords', []) for w in kw.split()[:1]}


def link(cand, eqs):
    """Best canonical equation for a noisy candidate, by signature RECALL (does the candidate carry the
    equation's variables?). Returns (eq, score) or (None, best) below threshold."""
    cs = signature(cand)
    if len(cs) < 2:
        return None, 0.0
    best, best_s = None, 0.0
    for eq in eqs:
        sig = eq['_sig']
        if not sig:
            continue
        recall = len(cs & sig) / len(sig)              # fraction of the canon eq's vars present
        prec = len(cs & sig) / len(cs)                 # how much of the candidate it explains
        s = recall * 0.7 + prec * 0.3
        if s > best_s:
            best_s, best = s, eq
    return (best, best_s) if best_s >= THRESH else (None, best_s)


def field_candidates(field):
    d = os.path.join(BRAIN, field)
    if not os.path.isdir(d):
        return []
    out = []
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
            for line in (o.get('text') or '').splitlines():
                if is_formula(line):
                    out.append(line.strip())
    return out


def main():
    fields = sys.argv[1:] or [d for d in sorted(canon) if not d.startswith('_')]
    os.makedirs(OUT, exist_ok=True)
    grand = {}
    for field in fields:
        eqs = canon.get(field)
        if not eqs:
            print(f'  {field:24} no canonical set'); continue
        cands = field_candidates(field)
        hits = collections.defaultdict(list)        # eq id → linked noisy fragments
        linked = dropped = 0
        for c in cands:
            eq, s = link(c, eqs)
            if eq:
                hits[eq['id']].append((round(s, 2), c)); linked += 1
            else:
                dropped += 1
        found = [eq for eq in eqs if len(hits[eq['id']]) >= MIN_HITS]
        # CLEAN CARD — canonical forms, by topic
        path = os.path.join(OUT, f'notecard-{field}.md')
        by_topic = collections.defaultdict(list)
        for eq in found:
            by_topic[eq['topic']].append(eq)
        with open(path, 'w') as f:
            f.write(f'# {field} — exam note card · {len(found)}/{len(eqs)} canonical equations present in corpus\n')
            for topic in sorted(by_topic):
                f.write(f'\n## {topic}\n')
                for eq in by_topic[topic]:
                    f.write(f'- **{eq["name"]}**: `{eq["form"]}`  ({len(hits[eq["id"]])} links)\n')
        cov = len(found) / len(eqs)
        print(f'  {field:24} {len(found):2}/{len(eqs):2} canon present ({cov:.0%}) · {linked} linked, {dropped} dropped as noise → {path}')
        grand[field] = {'found': len(found), 'total': len(eqs), 'linked': linked, 'dropped': dropped,
                        'linkmap': {eqid: [c for _, c in v[:3]] for eqid, v in hits.items()}}
    # the link map → cleans the golden corpus (noisy fragment → canonical id)
    json.dump(grand, open(os.path.join(OUT, '_coverage.json'), 'w'), indent=2)
    print(f'\n# clean cards + coverage → {OUT}  ·  link map (_coverage.json) feeds the gold-corpus cleanup')


if __name__ == '__main__':
    main()
